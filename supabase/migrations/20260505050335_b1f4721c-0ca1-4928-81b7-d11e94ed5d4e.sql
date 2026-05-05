
-- 1. FK для PostgREST embedding в sub_forum_*
ALTER TABLE public.sub_forum_topics
  ADD CONSTRAINT sub_forum_topics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.sub_forum_posts
  ADD CONSTRAINT sub_forum_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.sub_forum_topics
  ADD CONSTRAINT sub_forum_topics_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.sub_forum_categories(id) ON DELETE CASCADE;
ALTER TABLE public.sub_forum_posts
  ADD CONSTRAINT sub_forum_posts_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.sub_forum_topics(id) ON DELETE CASCADE;

-- 2. Колонка hidden_reason
ALTER TABLE public.resources         ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.topics            ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.posts             ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.sub_forum_topics  ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.sub_forum_posts   ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.videos            ADD COLUMN IF NOT EXISTS hidden_reason text;

-- 3. Audit log модерации
CREATE TABLE IF NOT EXISTS public.moderation_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id uuid NOT NULL,
  scope text NOT NULL,            -- 'prohub' | 'codeforum' | 'subforum'
  content_type text NOT NULL,     -- 'topic' | 'post'
  content_id uuid NOT NULL,
  action text NOT NULL,           -- 'pin' | 'unpin' | 'lock' | 'unlock' | 'hide' | 'show'
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.moderation_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins/mods view audit log" ON public.moderation_audit_log
  FOR SELECT USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));
CREATE POLICY "System insert audit log" ON public.moderation_audit_log
  FOR INSERT WITH CHECK (true);

-- 4. View throttle table
CREATE TABLE IF NOT EXISTS public.topic_view_throttle (
  scope text NOT NULL,
  topic_id uuid NOT NULL,
  viewer_key text NOT NULL,
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, topic_id, viewer_key)
);
ALTER TABLE public.topic_view_throttle ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no client read throttle" ON public.topic_view_throttle FOR SELECT USING (false);

-- 5. RPC: модерация темы (prohub/codeforum/subforum)
CREATE OR REPLACE FUNCTION public.moderate_topic(
  _scope text, _topic_id uuid, _action text, _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_can boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_can := public.can_moderate_content(v_uid, 'topic');
  IF NOT v_can THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _scope IN ('prohub','codeforum') THEN
    IF _action = 'pin'    THEN UPDATE topics SET is_pinned = true  WHERE id=_topic_id;
    ELSIF _action='unpin' THEN UPDATE topics SET is_pinned = false WHERE id=_topic_id;
    ELSIF _action='lock'  THEN UPDATE topics SET is_locked = true  WHERE id=_topic_id;
    ELSIF _action='unlock'THEN UPDATE topics SET is_locked = false WHERE id=_topic_id;
    ELSIF _action='hide'  THEN
      IF _reason IS NULL OR btrim(_reason)='' THEN RAISE EXCEPTION 'Reason required'; END IF;
      UPDATE topics SET is_hidden = true, hidden_reason = _reason WHERE id=_topic_id;
    ELSIF _action='show'  THEN UPDATE topics SET is_hidden = false, hidden_reason = NULL WHERE id=_topic_id;
    ELSE RAISE EXCEPTION 'Unknown action'; END IF;
  ELSIF _scope='subforum' THEN
    IF _action = 'pin'    THEN UPDATE sub_forum_topics SET is_pinned = true  WHERE id=_topic_id;
    ELSIF _action='unpin' THEN UPDATE sub_forum_topics SET is_pinned = false WHERE id=_topic_id;
    ELSIF _action='lock'  THEN UPDATE sub_forum_topics SET is_locked = true  WHERE id=_topic_id;
    ELSIF _action='unlock'THEN UPDATE sub_forum_topics SET is_locked = false WHERE id=_topic_id;
    ELSIF _action='hide'  THEN
      IF _reason IS NULL OR btrim(_reason)='' THEN RAISE EXCEPTION 'Reason required'; END IF;
      UPDATE sub_forum_topics SET is_hidden = true, hidden_reason = _reason WHERE id=_topic_id;
    ELSIF _action='show'  THEN UPDATE sub_forum_topics SET is_hidden = false, hidden_reason = NULL WHERE id=_topic_id;
    ELSE RAISE EXCEPTION 'Unknown action'; END IF;
  ELSE RAISE EXCEPTION 'Unknown scope'; END IF;

  INSERT INTO moderation_audit_log(moderator_id, scope, content_type, content_id, action, reason)
  VALUES (v_uid, _scope, 'topic', _topic_id, _action, _reason);
END $$;

-- 6. RPC: модерация поста (по аналогии)
CREATE OR REPLACE FUNCTION public.moderate_post(
  _scope text, _post_id uuid, _action text, _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_moderate_content(v_uid, 'post') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _scope IN ('prohub','codeforum') THEN
    IF _action='hide' THEN
      IF _reason IS NULL OR btrim(_reason)='' THEN RAISE EXCEPTION 'Reason required'; END IF;
      UPDATE posts SET is_hidden=true, hidden_reason=_reason WHERE id=_post_id;
    ELSIF _action='show' THEN UPDATE posts SET is_hidden=false, hidden_reason=NULL WHERE id=_post_id;
    ELSE RAISE EXCEPTION 'Unknown action'; END IF;
  ELSIF _scope='subforum' THEN
    IF _action='hide' THEN
      IF _reason IS NULL OR btrim(_reason)='' THEN RAISE EXCEPTION 'Reason required'; END IF;
      UPDATE sub_forum_posts SET is_hidden=true, hidden_reason=_reason WHERE id=_post_id;
    ELSIF _action='show' THEN UPDATE sub_forum_posts SET is_hidden=false, hidden_reason=NULL WHERE id=_post_id;
    ELSE RAISE EXCEPTION 'Unknown action'; END IF;
  ELSE RAISE EXCEPTION 'Unknown scope'; END IF;

  INSERT INTO moderation_audit_log(moderator_id, scope, content_type, content_id, action, reason)
  VALUES (v_uid, _scope, 'post', _post_id, _action, _reason);
END $$;

-- 7. RPC: увеличить views с throttle (10 мин)
CREATE OR REPLACE FUNCTION public.increment_topic_views(
  _scope text, _topic_id uuid, _viewer_key text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last timestamptz;
BEGIN
  SELECT last_at INTO v_last FROM topic_view_throttle
   WHERE scope=_scope AND topic_id=_topic_id AND viewer_key=_viewer_key;
  IF v_last IS NOT NULL AND v_last > now() - interval '10 minutes' THEN
    RETURN;
  END IF;

  INSERT INTO topic_view_throttle(scope, topic_id, viewer_key, last_at)
  VALUES (_scope, _topic_id, _viewer_key, now())
  ON CONFLICT (scope, topic_id, viewer_key) DO UPDATE SET last_at = now();

  IF _scope IN ('prohub','codeforum') THEN
    UPDATE topics SET views = COALESCE(views,0)+1 WHERE id=_topic_id;
  ELSIF _scope='subforum' THEN
    UPDATE sub_forum_topics SET views = COALESCE(views,0)+1 WHERE id=_topic_id;
  END IF;
END $$;

-- 8. Расширить RLS на UPDATE для модерации (mod не имеет прямого UPDATE)
-- Уже есть policy "update own sub_forum_topics" разрешающая mod/admin — оставляем
-- Для prohub/codeforum topics добавим политику для модераторов:
DROP POLICY IF EXISTS "Mods can moderate topics" ON public.topics;
CREATE POLICY "Mods can moderate topics" ON public.topics
  FOR UPDATE USING (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=auth.uid()
                AND ur.role='moderator' AND COALESCE(ur.can_moderate_topics,false)=true)
  );

-- 9. Realtime для sub_forum_topics
ALTER TABLE public.sub_forum_topics REPLICA IDENTITY FULL;
ALTER TABLE public.sub_forum_posts REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='sub_forum_topics') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sub_forum_topics';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='sub_forum_posts') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sub_forum_posts';
  END IF;
END $$;
