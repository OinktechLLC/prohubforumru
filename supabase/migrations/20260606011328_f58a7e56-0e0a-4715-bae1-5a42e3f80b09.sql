
ALTER TABLE public.brand_accounts ADD COLUMN IF NOT EXISTS views integer NOT NULL DEFAULT 0;
ALTER TABLE public.brand_accounts ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.brand_profile_view_throttle (
  brand_id uuid NOT NULL,
  viewer_key text NOT NULL,
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, viewer_key)
);
GRANT SELECT, INSERT, UPDATE ON public.brand_profile_view_throttle TO anon, authenticated;
GRANT ALL ON public.brand_profile_view_throttle TO service_role;
ALTER TABLE public.brand_profile_view_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "throttle_all_rw" ON public.brand_profile_view_throttle;
CREATE POLICY "throttle_all_rw" ON public.brand_profile_view_throttle FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.increment_brand_views(_brand_id uuid, _viewer_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last timestamptz;
BEGIN
  SELECT last_at INTO v_last FROM brand_profile_view_throttle
   WHERE brand_id=_brand_id AND viewer_key=_viewer_key;
  IF v_last IS NOT NULL AND v_last > now() - interval '30 minutes' THEN
    RETURN;
  END IF;
  INSERT INTO brand_profile_view_throttle(brand_id, viewer_key, last_at)
  VALUES (_brand_id, _viewer_key, now())
  ON CONFLICT (brand_id, viewer_key) DO UPDATE SET last_at = now();
  UPDATE brand_accounts SET views = COALESCE(views,0)+1 WHERE id = _brand_id;
END $$;
