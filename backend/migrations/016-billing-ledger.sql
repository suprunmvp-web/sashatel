
CREATE TABLE control.billing_transactions (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES control.organizations(id),
 actor_user_id uuid NOT NULL REFERENCES control.users(id),
 request_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('payment','debit')),
 amount_kopeks bigint NOT NULL CHECK(amount_kopeks>0),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 5 AND 500),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_key)
);

CREATE UNIQUE INDEX billing_payment_reference_unique
 ON control.billing_transactions(reference)
 WHERE kind='payment';

CREATE INDEX billing_transactions_org_date_idx
 ON control.billing_transactions(organization_id,recorded_at DESC);

ALTER TABLE control.billing_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.billing_transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant ON control.billing_transactions
 USING(organization_id=nullif(current_setting('control.tenant',true),'')::uuid);

REVOKE ALL ON control.billing_transactions FROM PUBLIC;
REVOKE ALL ON control.billing_transactions FROM control_runtime;

CREATE TABLE control.billing_payment_allocations (
 transaction_id uuid NOT NULL REFERENCES control.billing_transactions(id),
 organization_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 amount_kopeks bigint NOT NULL CHECK(amount_kopeks>0),
 PRIMARY KEY(transaction_id,invoice_id),
 FOREIGN KEY(organization_id,invoice_id)
 REFERENCES control.billing_obligations(organization_id,id)
);

ALTER TABLE control.billing_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.billing_payment_allocations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant ON control.billing_payment_allocations
 USING(organization_id=nullif(current_setting('control.tenant',true),'')::uuid);

REVOKE ALL ON control.billing_payment_allocations FROM PUBLIC;
REVOKE ALL ON control.billing_payment_allocations FROM control_runtime;

CREATE FUNCTION web_auth.billing_summary(actor uuid, org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE
 charges numeric;
 payments numeric;
 debits numeric;
 legacy_paid numeric;
 outstanding numeric;
 overdue numeric;
 allocated numeric;
 next_due timestamptz;
BEGIN
 IF coalesce(web_auth.internal_staff_role(actor),'')
 NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED' USING ERRCODE='42501';
 END IF;

 IF NOT EXISTS(
  SELECT 1 FROM control.organizations WHERE id=org_id
 ) THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE='P0002';
 END IF;

 PERFORM set_config('control.tenant',org_id::text,true);

 SELECT coalesce(sum(amount_kopeks),0)
 INTO charges FROM control.postpaid_usage
 WHERE organization_id=org_id;

 SELECT
  coalesce(sum(amount_kopeks) FILTER(WHERE kind='payment'),0),
  coalesce(sum(amount_kopeks) FILTER(WHERE kind='debit'),0)
 INTO payments,debits
 FROM control.billing_transactions WHERE organization_id=org_id;

 SELECT coalesce(sum(amount_kopeks),0) INTO allocated
 FROM control.billing_payment_allocations
 WHERE organization_id=org_id;

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

 RETURN jsonb_build_object(
  'organization_id',org_id,
  'charges_kopeks',charges::text,
  'payments_kopeks',payments::text,
  'legacy_paid_kopeks',legacy_paid::text,
  'debits_kopeks',debits::text,
  'balance_kopeks',(payments+legacy_paid-charges-debits)::text,
  'outstanding_invoices_kopeks',outstanding::text,
  'overdue_kopeks',overdue::text,
  'next_payment_at',next_due
 );
END $$;

REVOKE ALL ON FUNCTION
 web_auth.billing_summary(uuid,uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.billing_summary(uuid,uuid) TO control_runtime;


CREATE FUNCTION web_auth.record_billing_transaction(
 actor uuid, org_id uuid, operation_id uuid,
 operation_key uuid, operation_kind text,
 amount bigint, operation_reference text,
 operation_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE
 existing control.billing_transactions%ROWTYPE;
 invoice record;
 remaining bigint;
 allocation bigint;
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

 IF operation_kind IS NULL OR
    operation_kind NOT IN ('payment','debit')
    OR amount IS NULL OR amount<=0
    OR operation_key IS NULL
    OR operation_reference IS NULL
    OR operation_reason IS NULL
    OR length(trim(operation_reference)) NOT BETWEEN 5 AND 500
    OR length(trim(operation_reason)) NOT BETWEEN 8 AND 2000
 THEN
  RAISE EXCEPTION 'INVALID_BILLING_OPERATION'
   USING ERRCODE='22023';
 END IF;

 PERFORM 1 FROM control.organizations
 WHERE id=org_id FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 PERFORM set_config('control.tenant',org_id::text,true);

 SELECT * INTO existing FROM control.billing_transactions
 WHERE organization_id=org_id AND request_key=operation_key;

 IF FOUND THEN
  IF existing.kind<>operation_kind
   OR existing.amount_kopeks<>amount
   OR existing.reference<>operation_reference
   OR existing.reason<>operation_reason
  THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'
    USING ERRCODE='23505';
  END IF;

  RETURN jsonb_build_object(
   'transaction_id',existing.id,
   'replayed',true
  );
 END IF;

 INSERT INTO control.billing_transactions
 (id,organization_id,actor_user_id,request_key,kind,
  amount_kopeks,reference,reason)
 VALUES(operation_id,org_id,actor,operation_key,
 operation_kind,amount,operation_reference,operation_reason);

 IF operation_kind='payment' THEN
  remaining:=amount;

  FOR invoice IN
   SELECT id,amount_kopeks,paid_kopeks
   FROM control.billing_obligations
   WHERE organization_id=org_id AND state='issued'
   AND paid_kopeks<amount_kopeks
   ORDER BY due_at,issued_at,id
   FOR UPDATE
  LOOP
   EXIT WHEN remaining=0;

   allocation:=least(
    remaining,invoice.amount_kopeks-invoice.paid_kopeks
   );

   UPDATE control.billing_obligations
   SET paid_kopeks=paid_kopeks+allocation
   WHERE organization_id=org_id AND id=invoice.id;

   INSERT INTO control.billing_payment_allocations
   (transaction_id,organization_id,invoice_id,amount_kopeks)
   VALUES(operation_id,org_id,invoice.id,allocation);

   remaining:=remaining-allocation;
  END LOOP;
 END IF;

 RETURN jsonb_build_object(
  'transaction_id',operation_id,
  'replayed',false
 );
END $$;

REVOKE ALL ON FUNCTION web_auth.record_billing_transaction(
 uuid,uuid,uuid,uuid,text,bigint,text,text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION web_auth.record_billing_transaction(
 uuid,uuid,uuid,uuid,text,bigint,text,text
) TO control_runtime;


CREATE FUNCTION web_auth.change_billing_due_date(
 actor uuid,org_id uuid,target_invoice uuid,
 next_due timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE current_invoice record;
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

 PERFORM 1 FROM control.organizations
 WHERE id=org_id FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 PERFORM set_config('control.tenant',org_id::text,true);

 SELECT issued_at,due_at INTO current_invoice
 FROM control.billing_obligations
 WHERE organization_id=org_id AND id=target_invoice
 AND state='issued' AND paid_kopeks<amount_kopeks
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'RESOURCE_NOT_FOUND'
   USING ERRCODE='P0002';
 END IF;

 IF next_due IS NULL OR NOT isfinite(next_due)
 OR next_due<=current_invoice.issued_at THEN
  RAISE EXCEPTION 'INVALID_DUE_DATE'
   USING ERRCODE='22023';
 END IF;

 UPDATE control.billing_obligations
 SET due_at=next_due
 WHERE organization_id=org_id AND id=target_invoice;

 RETURN jsonb_build_object(
  'previous_due_at',current_invoice.due_at,
  'due_at',next_due
 );
END $$;

REVOKE ALL ON FUNCTION web_auth.change_billing_due_date(
 uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION web_auth.change_billing_due_date(
 uuid,uuid,uuid,timestamptz
) TO control_runtime;


CREATE FUNCTION web_auth.billing_history(
 actor uuid,org_id uuid,p_offset integer,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE result jsonb;
BEGIN
 IF coalesce(web_auth.internal_staff_role(actor),'')
 NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED'
   USING ERRCODE='42501';
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

 PERFORM set_config('control.tenant',org_id::text,true);

 SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)
 INTO result FROM (
  SELECT id,actor_user_id,kind,
   amount_kopeks::text AS amount_kopeks,
   reference,reason,recorded_at
  FROM control.billing_transactions
  WHERE organization_id=org_id
  ORDER BY recorded_at DESC,id DESC
  LIMIT p_limit OFFSET p_offset
 ) t;

 RETURN result;
END $$;

REVOKE ALL ON FUNCTION web_auth.billing_history(
 uuid,uuid,integer,integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION web_auth.billing_history(
 uuid,uuid,integer,integer
) TO control_runtime;
