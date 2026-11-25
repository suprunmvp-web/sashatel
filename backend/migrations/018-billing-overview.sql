
CREATE INDEX postpaid_usage_org_recorded_idx
 ON control.postpaid_usage(organization_id,recorded_at);

CREATE FUNCTION web_auth.lock_invoice_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
BEGIN
 PERFORM set_config('control.tenant',NEW.organization_id::text,true);

 PERFORM 1 FROM control.organizations
 WHERE id=NEW.organization_id FOR UPDATE;

 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.lock_invoice_organization() FROM PUBLIC;

CREATE TRIGGER billing_invoice_organization_lock
 BEFORE INSERT ON control.billing_obligations
 FOR EACH ROW
 EXECUTE FUNCTION web_auth.lock_invoice_organization();


CREATE FUNCTION web_auth.allocate_invoice_advances()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE
 payment record;
 remaining bigint;
 allocation bigint;
BEGIN
 IF NEW.state<>'issued'
 OR NEW.paid_kopeks>=NEW.amount_kopeks THEN
  RETURN NEW;
 END IF;

 PERFORM set_config('control.tenant',NEW.organization_id::text,true);

 remaining:=NEW.amount_kopeks-NEW.paid_kopeks;

 FOR payment IN
  SELECT t.id,
   t.amount_kopeks-coalesce((
    SELECT sum(a.amount_kopeks)
    FROM control.billing_payment_allocations a
    WHERE a.transaction_id=t.id
    AND a.organization_id=NEW.organization_id
   ),0) AS available
  FROM control.billing_transactions t
  WHERE t.organization_id=NEW.organization_id
  AND t.kind='payment'
  ORDER BY t.recorded_at,t.id
 LOOP
  EXIT WHEN remaining=0;
  CONTINUE WHEN payment.available<=0;

  allocation:=least(remaining,payment.available);

  INSERT INTO control.billing_payment_allocations
   (transaction_id,organization_id,invoice_id,amount_kopeks)
  VALUES(payment.id,NEW.organization_id,NEW.id,allocation);

  UPDATE control.billing_obligations
  SET paid_kopeks=paid_kopeks+allocation
  WHERE organization_id=NEW.organization_id
   AND id=NEW.id;

  remaining:=remaining-allocation;
 END LOOP;

 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.allocate_invoice_advances() FROM PUBLIC;

CREATE TRIGGER billing_allocate_invoice_advances
 AFTER INSERT ON control.billing_obligations
 FOR EACH ROW
 EXECUTE FUNCTION web_auth.allocate_invoice_advances();


CREATE FUNCTION web_auth.internal_billing_overview(
 actor uuid,p_from date,p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE
 item record;
 day_item record;
 from_ts timestamptz;
 to_ts timestamptz;
 organizations_count bigint:=0;
 verified_count bigint:=0;
 total_seconds numeric:=0;
 total_charges numeric:=0;
 total_payments numeric:=0;
 total_debits numeric:=0;
 series jsonb:='{}'::jsonb;
 day_key text;
 current_day jsonb;
BEGIN
 IF coalesce(web_auth.internal_staff_role(actor),'')
 NOT IN ('owner','admin','manager') THEN
  RAISE EXCEPTION 'INTERNAL_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF p_from IS NULL OR p_to IS NULL
 OR NOT isfinite(p_from) OR NOT isfinite(p_to)
 OR p_to<p_from OR p_to-p_from>365 THEN
  RAISE EXCEPTION 'INVALID_DATE_RANGE'
   USING ERRCODE='22023';
 END IF;

 from_ts:=p_from::timestamp AT TIME ZONE 'Europe/Moscow';
 to_ts:=(p_to+1)::timestamp AT TIME ZONE 'Europe/Moscow';

 FOR day_item IN
  SELECT d::date AS day
  FROM generate_series(
   p_from::timestamp,p_to::timestamp,interval '1 day'
  ) d
 LOOP
  series:=series||jsonb_build_object(
   day_item.day::text,
   jsonb_build_object(
    'billable_seconds',0,
    'charges_kopeks',0,
    'payments_kopeks',0
   )
  );
 END LOOP;

 FOR item IN
  SELECT id,verification_status
  FROM control.organizations
 LOOP
  organizations_count:=organizations_count+1;

  IF item.verification_status='verified' THEN
   verified_count:=verified_count+1;
  END IF;

  PERFORM set_config('control.tenant',item.id::text,true);

  FOR day_item IN
   SELECT
    (recorded_at AT TIME ZONE 'Europe/Moscow')::date AS day,
    sum(billable_seconds)::numeric AS seconds,
    sum(amount_kopeks)::numeric AS charges
   FROM control.postpaid_usage
   WHERE organization_id=item.id
    AND recorded_at>=from_ts AND recorded_at<to_ts
   GROUP BY 1
  LOOP
   total_seconds:=total_seconds+day_item.seconds;
   total_charges:=total_charges+day_item.charges;

   day_key:=day_item.day::text;
   current_day:=series->day_key;

   series:=jsonb_set(series,ARRAY[day_key],
    current_day||jsonb_build_object(
     'billable_seconds',
      (current_day->>'billable_seconds')::numeric+day_item.seconds,
     'charges_kopeks',
      (current_day->>'charges_kopeks')::numeric+day_item.charges
    ));
  END LOOP;

  FOR day_item IN
   SELECT
    (recorded_at AT TIME ZONE 'Europe/Moscow')::date AS day,
    coalesce(sum(amount_kopeks)
     FILTER(WHERE kind='payment'),0) AS payments,
    coalesce(sum(amount_kopeks)
     FILTER(WHERE kind='debit'),0) AS debits
   FROM control.billing_transactions
   WHERE organization_id=item.id
    AND recorded_at>=from_ts AND recorded_at<to_ts
   GROUP BY 1
  LOOP
   total_payments:=total_payments+day_item.payments;
   total_debits:=total_debits+day_item.debits;

   day_key:=day_item.day::text;
   current_day:=series->day_key;

   series:=jsonb_set(series,ARRAY[day_key],
    current_day||jsonb_build_object(
     'payments_kopeks',
      (current_day->>'payments_kopeks')::numeric+day_item.payments
    ));
  END LOOP;
 END LOOP;

 RETURN jsonb_build_object(
  'from',p_from,
  'to',p_to,
  'timezone','Europe/Moscow',
  'organizations_count',organizations_count,
  'verified_organizations_count',verified_count,
  'billable_seconds',total_seconds::text,
  'billable_minutes',round(total_seconds/60,2)::text,
  'charges_kopeks',total_charges::text,
  'payments_kopeks',total_payments::text,
  'debits_kopeks',total_debits::text,
  'daily',(
   SELECT jsonb_agg(
    jsonb_build_object(
     'date',k,
     'billable_seconds',v->>'billable_seconds',
     'charges_kopeks',v->>'charges_kopeks',
     'payments_kopeks',v->>'payments_kopeks'
    ) ORDER BY k
   )
   FROM jsonb_each(series) AS e(k,v)
  )
 );
END $$;

REVOKE ALL ON FUNCTION
 web_auth.internal_billing_overview(uuid,date,date)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.internal_billing_overview(uuid,date,date)
 TO control_runtime;
