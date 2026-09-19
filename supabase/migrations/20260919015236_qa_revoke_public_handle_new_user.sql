/*
# QA fix: revoke remaining PUBLIC execute grant on handle_new_user

The earlier revoke removed anon/authenticated grants, but the default
PUBLIC grant remained. This function is only meant to fire as an auth
signup trigger, never to be called directly through the API.
*/

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
