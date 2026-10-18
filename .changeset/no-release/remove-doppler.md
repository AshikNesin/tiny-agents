Remove Doppler from secrets management.

Secrets now come from real environment variables only (hosting platform env
vars or a git-ignored .env file). Drops the @varlock/doppler-plugin, the
DOPPLER_TOKEN item, and doppler() resolvers from .env.schema; production
secrets resolve from ambient env. Docs and setup scripts updated to match.
App-only change (no packages/\*/src surface); no release needed.
