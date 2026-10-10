#!/bin/sh
# Start command for hosts with no separate release step (Render's free plan).
#
# A file rather than an inline `sh -c "..."`: Render does not parse quotes in
# `dockerCommand`, so the quoted string reached sh as one word and failed with
# "not found".
#
# `migrate deploy` only applies what is new, and takes an advisory lock.
set -e
node_modules/.bin/prisma migrate deploy
# exec: node becomes PID 1 and receives SIGTERM directly.
exec node dist/main.js
