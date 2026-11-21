#!/bin/sh
# {{hook}} – calls buggy's tagging script (installed by the buggy plugin)
sh "$(git rev-parse --show-toplevel)/.githooks/buggy-tag.sh" || true # buggy
