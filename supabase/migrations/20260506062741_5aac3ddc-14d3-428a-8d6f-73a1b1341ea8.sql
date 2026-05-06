ALTER TABLE public.posts REPLICA IDENTITY FULL;
ALTER TABLE public.topics REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.topics;