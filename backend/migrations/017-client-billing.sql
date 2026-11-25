
CREATE TABLE control.billing_schedules (
 organization_id uuid PRIMARY KEY
  REFERENCES control.organizations(id),
 next_period_end date NOT NULL,
 updated_by uuid NOT NULL REFERENCES control.users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE control.billing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.billing_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant ON control.billing_schedules
 USING(organization_id=nullif(current_setting('control.tenant',true),'')::uuid);

REVOKE ALL ON control.billing_schedules FROM PUBLIC;
REVOKE ALL ON control.billing_schedules FROM control_runtime;

CREATE FUNCTION web_auth.set_billing_schedule(
 actor uuid,org_id uuid,period_end date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE previous_date date;
BEGIN
 PERFORM 1 FROM web_auth.internal_staff s
 JOIN control.users u ON u.id=s.user_id
 WHERE s.user_id=actor AND s.active AND u.active
 AND u.email_verified_at IS NOT NULL
 AND s.role IN ('owner','admin')
 FOR SHARE OF s;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF period_end IS NULL OR NOT isfinite(period_end)
 OR period_end<(clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date
 THEN
  RAISE EXCEPTION 'INVALID_BILLING_DATE'
   USING ERRCODE='22023';
 END IF;

 PERFORM set_config('control.tenant',org_id::text,true);

 PERFORM 1 FROM control.organizations
 WHERE id=org_id FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 SELECT next_period_end INTO previous_date
 FROM control.billing_schedules
 WHERE organization_id=org_id;

 IF previous_date IS NOT DISTINCT FROM period_end THEN
  RETURN NULL;
 END IF;

 INSERT INTO control.billing_schedules
 (organization_id,next_period_end,updated_by)
 VALUES(org_id,period_end,actor)
 ON CONFLICT(organization_id) DO UPDATE
 SET next_period_end=excluded.next_period_end,
     updated_by=excluded.updated_by,
     updated_at=clock_timestamp();

 RETURN jsonb_build_object(
  'previous_period_end',previous_date,
  'next_period_end',period_end
 );
END $$;

REVOKE ALL ON FUNCTION web_auth.set_billing_schedule(
 uuid,uuid,date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION web_auth.set_billing_schedule(
 uuid,uuid,date
) TO control_runtime;


CREATE FUNCTION web_auth.client_billing_access(
 actor uuid,org_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM control.organizations o
  JOIN control.memberships m ON m.organization_id=o.id
  JOIN control.users u ON u.id=m.user_id
  WHERE o.id=org_id AND o.active
  AND m.active AND m.user_id=actor
  AND u.active AND u.email_verified_at IS NOT NULL
  AND (o.owner_membership_id=m.id OR m.role_id='admin')
 )
$$;

REVOKE ALL ON FUNCTION
 web_auth.client_billing_access(uuid,uuid) FROM PUBLIC;


CREATE FUNCTION web_auth.organization_billing_details(
 actor uuid,org_id uuid,internal_access boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE
 charges numeric;
 payments numeric;
 debits numeric;
 legacy_paid numeric;
 allocated numeric;
 outstanding numeric;
 overdue numeric;
 next_due timestamptz;
 period_end date;
BEGIN
 PERFORM set_config('control.tenant',org_id::text,true);

 IF internal_access IS TRUE THEN
  IF coalesce(web_auth.internal_staff_role(actor),'')
   NOT IN ('owner','admin') THEN
   RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED'
    USING ERRCODE='42501';
  END IF;
 ELSE
  IF NOT web_auth.client_billing_access(actor,org_id) THEN
   RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED'
    USING ERRCODE='42501';
  END IF;
 END IF;

 IF NOT EXISTS(
  SELECT 1 FROM control.organizations WHERE id=org_id
 ) THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 SELECT coalesce(sum(amount_kopeks),0)
 INTO charges FROM control.postpaid_usage
 WHERE organization_id=org_id;

 SELECT
  coalesce(sum(amount_kopeks) FILTER(WHERE kind='payment'),0),
  coalesce(sum(amount_kopeks) FILTER(WHERE kind='debit'),0)
 INTO payments,debits
 FROM control.billing_transactions
 WHERE organization_id=org_id;

 SELECT coalesce(sum(a.amount_kopeks),0)
 INTO allocated
 FROM control.billing_payment_allocations a
 JOIN control.billing_obligations b
 ON (b.organization_id,b.id)=(a.organization_id,a.invoice_id)
 WHERE a.organization_id=org_id AND b.state='issued';

 SELECT
  coalesce(sum(paid_kopeks),0),
  coalesce(sum(amount_kopeks-paid_kopeks),0),
  coalesce(sum(amount_kopeks-paid_kopeks)
   FILTER(WHERE due_at<clock_timestamp()),0),
  min(due_at) FILTER(WHERE paid_kopeks<amount_kopeks)
 INTO legacy_paid,outstanding,overdue,next_due
 FROM control.billing_obligations
 WHERE organization_id=org_id AND state='issued';

 legacy_paid:=greatest(legacy_paid-allocated,0);

 SELECT next_period_end INTO period_end
 FROM control.billing_schedules WHERE organization_id=org_id;

 RETURN jsonb_build_object(
  'organization_id',org_id,
  'charges_kopeks',charges::text,
  'payments_kopeks',payments::text,
  'legacy_paid_kopeks',legacy_paid::text,
  'debits_kopeks',debits::text,
  'balance_kopeks',(payments+legacy_paid-charges-debits)::text,
  'outstanding_invoices_kopeks',outstanding::text,
  'overdue_kopeks',overdue::text,
  'next_payment_at',next_due,
  'next_period_end',period_end,
  'telephony_payment_blocked',overdue>0
 );
END $$;

REVOKE ALL ON FUNCTION
 web_auth.organization_billing_details(uuid,uuid,boolean)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.organization_billing_details(uuid,uuid,boolean)
 TO control_runtime;


CREATE FUNCTION web_auth.organization_invoices(
 actor uuid,org_id uuid,internal_access boolean,
 p_offset integer,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('control.tenant',org_id::text,true);

 IF internal_access IS TRUE THEN
  IF coalesce(web_auth.internal_staff_role(actor),'')
   NOT IN ('owner','admin') THEN
   RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED'
    USING ERRCODE='42501';
  END IF;
 ELSE
  IF NOT web_auth.client_billing_access(actor,org_id) THEN
   RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED'
    USING ERRCODE='42501';
  END IF;
 END IF;

 IF p_offset IS NULL OR p_limit IS NULL
 OR p_offset<0 OR p_offset>100000
 OR p_limit<1 OR p_limit>100 THEN
  RAISE EXCEPTION 'INVALID_PAGE'
   USING ERRCODE='22023';
 END IF;

 IF NOT EXISTS(
  SELECT 1 FROM control.organizations WHERE id=org_id
 ) THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 SELECT coalesce(
  jsonb_agg(to_jsonb(t) ORDER BY t.issued_at DESC,t.id DESC),
  '[]'::jsonb
 ) INTO result
 FROM (
  SELECT id,issued_at,due_at,
   amount_kopeks::text AS amount_kopeks,
   paid_kopeks::text AS paid_kopeks,
   (amount_kopeks-paid_kopeks)::text AS outstanding_kopeks,
   CASE
    WHEN state='void' THEN 'void'
    WHEN paid_kopeks=amount_kopeks THEN 'paid'
    WHEN due_at<clock_timestamp() THEN 'overdue'
    WHEN paid_kopeks>0 THEN 'partially_paid'
    ELSE 'unpaid'
   END AS status
  FROM control.billing_obligations
  WHERE organization_id=org_id
  ORDER BY issued_at DESC,id DESC
  LIMIT p_limit OFFSET p_offset
 ) t;

 RETURN result;
END $$;

REVOKE ALL ON FUNCTION web_auth.organization_invoices(
 uuid,uuid,boolean,integer,integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION web_auth.organization_invoices(
 uuid,uuid,boolean,integer,integer
) TO control_runtime;

CREATE OR REPLACE FUNCTION web_auth.billing_summary(
 actor uuid,org_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT web_auth.organization_billing_details(actor,org_id,true)
$$;
