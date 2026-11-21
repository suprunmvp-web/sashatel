-- Expose only boolean ownership/verification flags for authenticated suggestions.
-- SECURITY DEFINER bypasses tenant-scoped RLS only to return matched, verified INNs.
CREATE FUNCTION web_auth.verified_inns(p_inns text[])
RETURNS TABLE(inn text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$
  SELECT DISTINCT o.inn
  FROM control.organizations AS o
  WHERE o.inn = ANY(p_inns) AND o.verification_status = 'verified'
$$;
REVOKE ALL ON FUNCTION web_auth.verified_inns(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_auth.verified_inns(text[]) TO control_runtime;
