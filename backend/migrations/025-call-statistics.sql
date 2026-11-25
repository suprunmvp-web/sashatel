CREATE INDEX calls_reporting_period
 ON control.calls(organization_id,created_at DESC,id DESC);

CREATE FUNCTION web_auth.organization_call_statistics(
 actor uuid,org_id uuid,p_from date,p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE
 result jsonb;
 daily jsonb;
 initiation_count bigint;
 from_ts timestamptz;
 to_ts timestamptz;
BEGIN
 PERFORM set_config('control.tenant',org_id::text,true);

 IF NOT EXISTS(
  SELECT 1
  FROM control.memberships m
  JOIN control.users u ON u.id=m.user_id
  JOIN control.organizations o ON o.id=m.organization_id
  WHERE m.organization_id=org_id
  AND m.user_id=actor AND m.active
  AND u.active AND u.email_verified_at IS NOT NULL
  AND o.active AND m.role_id IN ('owner','admin')
 ) THEN
  RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF p_from IS NULL OR p_to IS NULL
 OR NOT isfinite(p_from) OR NOT isfinite(p_to)
 OR p_to<p_from OR p_to-p_from>365 THEN
  RAISE EXCEPTION 'INVALID_DATE_RANGE'
   USING ERRCODE='22023';
 END IF;

 WITH source AS (
  SELECT
   (c.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
   u.outcome,
   coalesce(u.billable_seconds,0) AS seconds,
   coalesce(u.amount_kopeks,0) AS charges
  FROM control.calls c
  JOIN control.postpaid_usage u
   ON u.organization_id=c.organization_id
   AND u.call_id=c.id
  WHERE c.organization_id=org_id
  AND c.created_at>=p_from::timestamp AT TIME ZONE 'Europe/Moscow'
  AND c.created_at<(p_to+1)::timestamp AT TIME ZONE 'Europe/Moscow'
 )
 SELECT jsonb_build_object(
  'from',p_from,
  'to',p_to,
  'timezone','Europe/Moscow',
  'completed_calls',count(*),
  'answered',count(*) FILTER(WHERE outcome='human'),
  'machine',count(*) FILTER(WHERE outcome='machine'),
  'no_answer',count(*) FILTER(WHERE outcome='no_answer'),
  'rejected',count(*) FILTER(WHERE outcome='rejected'),
  'error',count(*) FILTER(WHERE outcome='error'),
  'unknown',count(*) FILTER(WHERE outcome='unknown'),
  'billable_seconds',coalesce(sum(seconds),0),
  'charges_kopeks',coalesce(sum(charges),0)
 ) INTO result FROM source;


 from_ts:=p_from::timestamp AT TIME ZONE 'Europe/Moscow';
 to_ts:=(p_to+1)::timestamp AT TIME ZONE 'Europe/Moscow';

 WITH attempts AS (
  SELECT
   (c.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
   u.outcome,
   coalesce(u.billable_seconds,0) AS seconds
  FROM control.calls c
  JOIN control.carousel_outbox q
   ON q.organization_id=c.organization_id
   AND q.dispatch_id=c.id
  LEFT JOIN control.postpaid_usage u
   ON u.organization_id=c.organization_id
   AND u.call_id=c.id
  WHERE c.organization_id=org_id
  AND c.created_at>=from_ts AND c.created_at<to_ts
  AND q.state IN ('claimed','unknown','completed')
 ),
 aggregated AS (
  SELECT day,
   count(*) AS initiations,
   count(outcome) AS completed,
   count(*) FILTER(WHERE outcome='human') AS answered,
   coalesce(sum(seconds),0) AS seconds
  FROM attempts GROUP BY day
 ),
 days AS (
  SELECT d::date AS day
  FROM generate_series(
   p_from::timestamp,p_to::timestamp,interval '1 day'
  ) d
 )
 SELECT
  coalesce(sum(a.initiations),0),
  jsonb_agg(jsonb_build_object(
   'date',d.day,
   'initiations',coalesce(a.initiations,0),
   'completed_calls',coalesce(a.completed,0),
   'answered',coalesce(a.answered,0),
   'billable_seconds',coalesce(a.seconds,0),
   'answer_rate',CASE WHEN a.completed>0
    THEN round(100.0*a.answered/a.completed,2)
    ELSE NULL END
  ) ORDER BY d.day)
 INTO initiation_count,daily
 FROM days d
 LEFT JOIN aggregated a ON a.day=d.day;

 result:=result||jsonb_build_object(
  'initiations',initiation_count,
  'daily',daily,
  'answer_rate',CASE
   WHEN (result->>'completed_calls')::numeric>0
   THEN round(
    100.0*(result->>'answered')::numeric/
    (result->>'completed_calls')::numeric,2
   )
   ELSE NULL END
 );

 RETURN result;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.organization_call_statistics(uuid,uuid,date,date)
 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.organization_call_statistics(uuid,uuid,date,date)
 TO control_runtime;

CREATE FUNCTION web_auth.organization_call_history(
 actor uuid,org_id uuid,p_from date,p_to date,
 p_offset integer,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET control.tenant='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('control.tenant',org_id::text,true);

 IF NOT EXISTS(
  SELECT 1
  FROM control.memberships m
  JOIN control.users u ON u.id=m.user_id
  JOIN control.organizations o ON o.id=m.organization_id
  WHERE m.organization_id=org_id
  AND m.user_id=actor AND m.active
  AND u.active AND u.email_verified_at IS NOT NULL
  AND o.active AND m.role_id IN ('owner','admin')
 ) THEN
  RAISE EXCEPTION 'ORGANIZATION_ACCESS_DENIED'
   USING ERRCODE='42501';
 END IF;

 IF p_from IS NULL OR p_to IS NULL
 OR NOT isfinite(p_from) OR NOT isfinite(p_to)
 OR p_to<p_from OR p_to-p_from>365
 OR p_offset IS NULL OR p_offset<0
 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
 THEN
  RAISE EXCEPTION 'INVALID_HISTORY_FILTER'
   USING ERRCODE='22023';
 END IF;

 WITH source AS (
  SELECT c.id,c.created_at,c.destination,
   c.caller_id,c.trunk_id,c.state,c.membership_id,
   concat_ws(' ',usr.last_name,usr.first_name)
    AS employee_name,
   u.outcome,u.billable_seconds,u.amount_kopeks
  FROM control.calls c
  JOIN control.memberships m
   ON m.organization_id=c.organization_id
   AND m.id=c.membership_id
  JOIN control.users usr ON usr.id=m.user_id
  LEFT JOIN control.postpaid_usage u
   ON u.organization_id=c.organization_id
   AND u.call_id=c.id
  WHERE c.organization_id=org_id
  AND c.created_at>=p_from::timestamp AT TIME ZONE 'Europe/Moscow'
  AND c.created_at<(p_to+1)::timestamp AT TIME ZONE 'Europe/Moscow'
 ),
 page AS (
  SELECT * FROM source
  ORDER BY created_at DESC,id DESC
  OFFSET p_offset LIMIT p_limit
 )
 SELECT jsonb_build_object(
  'total',(SELECT count(*) FROM source),
  'offset',p_offset,
  'limit',p_limit,
  'items',coalesce(
   (SELECT jsonb_agg(to_jsonb(p)
    ORDER BY p.created_at DESC,p.id DESC)
    FROM page p),'[]'::jsonb)
 ) INTO result;

 RETURN result;
END $$;

REVOKE ALL ON FUNCTION
 web_auth.organization_call_history(
 uuid,uuid,date,date,integer,integer
 ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
 web_auth.organization_call_history(
 uuid,uuid,date,date,integer,integer
 ) TO control_runtime;
