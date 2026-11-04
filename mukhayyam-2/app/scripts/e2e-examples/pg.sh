#!/bin/bash
exec su postgres -s /bin/bash -c "psql $(printf %q\  "$@")"
