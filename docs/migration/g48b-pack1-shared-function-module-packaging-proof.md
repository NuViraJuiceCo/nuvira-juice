# G48B-PACK1: Shared function module packaging proof

## Executive summary

G48B-PACK1 inspected the installed Base44 CLI and disposable packaging fixtures to determine whether a Base44 function can safely import a shared local TypeScript module outside its own function directory.

Final classification:

```text
shared_function_module_packaging_unsupported
```

The installed Base44 CLI deployment implementation does not bundle an import graph. It collects `*.js`, `*.ts`, and `*.json` files from the selected function's own directory only, then sends a JSON payload containing:

```text
entry
files
automations
```

Therefore:

- Case A, a helper inside the same function directory, is supported.
- Case B, a shared helper under `base44/functions/_shared`, is not included in a named function deployment payload.
- Case C, a helper outside the functions root, is not included in a named function deployment payload.

G48B should not proceed by copying resolver code into multiple functions. That would replace manual duplication with generated/source-control duplication and would violate the G48A goal of a single shared source of truth.

## G48B blocker closeout

G48B PR #552 closed as a docs-only blocker phase.

Merge commit:

```text
9c1f3134cb80f51df6e4b323acf0b0e041b21902
```

G48B classification remains:

```text
native_identity_foundation_blocked_by_function_module_packaging
```

The G48B report was corrected to distinguish:

- unsupported;
- undocumented;
- not yet proven.

The original repository evidence showed undocumented/not-proven behavior. PACK1 adds CLI-source evidence and changes the packaging conclusion to unsupported for the needed shared-module case.

## Official/project structure finding

Base44's backend-functions documentation (https://docs.base44.com/developers/backend/resources/backend-functions/overview) describes each backend function as its own subdirectory with an `entry.ts` or `entry.js` file. It also states that specific functions can be deployed by name with `functions deploy <names...>`. The public documentation does not establish that sibling shared local imports are bundled into a named function deployment.

Project evidence before PACK1:

```text
base44/functions entrypoint count: 258
relative shared import count in base44/functions: 0
shared/_shared/lib function module directories found: none
repo deploy/build evidence for shared Base44 function module bundling: none found
```

## CLI implementation finding

Installed CLI:

```text
base44_version=0.0.55
base44_cli_path=/Users/nuvisionary/.npm-global/bin/base44
base44_cli_package=/Users/nuvisionary/.npm-global/lib/node_modules/base44
implementation=/Users/nuvisionary/.npm-global/lib/node_modules/base44/dist/cli/index.js
```

Relevant implementation facts from the installed CLI bundle:

1. `readAllFunctions(functionsDir)` discovers functions from `entry.ts` / `entry.js` under the functions root.
2. For a zero-config function, the function name is the path from `functionsDir` to the directory containing the entry file.
3. `readFunction` and zero-config function discovery collect files with:

```text
cwd=functionDir
pattern=**/*.{js,ts,json}
```

4. `loadFunctionCode(fn)` reads only `fn.filePaths` and rewrites paths relative to the selected function directory.
5. `deployOne(fn)` calls `deploySingleFunction` with only:

```text
entry: functionWithCode.entry
files: functionWithCode.files
automations: functionWithCode.automations
```

6. `deploySingleFunction` sends that JSON payload to:

```text
backend-functions/<function-name>
```

No deploy-path import graph, bundler, transpiler output, source-map archive, or zip/archive collection was found.

## Deployment payload type

```text
cli_function_payload_type=json_file_graph_entry_files_automations
cli_bundler_present=false
cli_bundler_name=none
transitive_local_import_collection=false
imports_limited_to_function_directory=true
imports_limited_to_functions_root=false
imports_outside_functions_root=false
```

The CLI package itself is bundled, but that is unrelated to deployed function packaging. PACK1 searched the actual `src/core/resources/function/deploy.ts` section in the installed CLI output and did not find a deploy-path bundler or import-graph collector.

## Case A/B/C import results

PACK1 used a disposable fixture outside the production function tree.

Fixture shape:

```text
/tmp/.../base44/functions/caseAFunction/entry.ts
/tmp/.../base44/functions/caseAFunction/helper.ts
/tmp/.../base44/functions/_shared/orderIdentity.ts
/tmp/.../base44/shared/orderIdentity.ts
```

The fixture entrypoint imported all three helper types:

```ts
import { localMarker } from './helper.ts';
import { rootSharedMarker } from '../_shared/orderIdentity.ts';
import { outsideMarker } from '../../shared/orderIdentity.ts';
```

Observed deploy file collection for `caseAFunction`:

```text
entry.ts
helper.ts
```

### Case A — function-local helper

```text
case_a_function_local_supported=true
```

A helper inside the selected function directory is included because it falls under `functionDir`.

### Case B — functions-root shared helper

```text
case_b_functions_root_shared_supported=false
```

A sibling helper under `base44/functions/_shared` is outside the selected function directory. It is not included in the named function payload.

A directory without `entry.ts` is not misclassified as a deployable function, but it is also not included as a dependency of another function.

### Case C — outside-functions-root helper

```text
case_c_outside_functions_root_supported=false
```

A helper under `base44/shared` is outside the selected function directory and is not included in the named function payload.

## Function-pull finding

A read-only pull was run against the already-deployed `previewNativeOrderCutoverReadiness` function into a temporary directory only.

```text
production_tree_modified=false
function_pulled=previewNativeOrderCutoverReadiness
pull_exit_code=0
pulled_file_count=2
pulled_files=function.jsonc, main.ts
```

The pulled function configuration showed:

```text
entry=main.ts
```

The pulled source contained one SDK import and no relative shared import. This supports that deployed source is represented as a remote file graph, not as proof of sibling shared import bundling. It does not override the deploy-source finding that named deploy uploads only files from the selected function directory.

## Static-proof decision

Static proof requirements from the PACK1 prompt:

| Requirement | Result |
| --- | --- |
| imports are followed transitively | fail |
| sibling shared files under functions root are included | fail |
| deployed artifact does not depend on unavailable local paths | fail for Case B/C if imported |
| deployment of one named function includes imported shared files | fail for Case B/C |
| shared folder without `entry.ts` is not deployed as another function | pass |
| resulting artifact is valid for Deno runtime | not applicable for Case B/C because dependency is not packaged |

Conclusion:

```text
shared_function_module_packaging_unsupported
```

The required G48B Case B packaging is statically ruled out for the installed CLI version.

## Controlled PACK2 probe decision

A controlled live probe is **not recommended** from current evidence.

Reason: the CLI source is not ambiguous. It sends only the selected function directory's files. A live probe would be expected to fail or deploy a function with an unresolved sibling import.

If Base44 later changes the CLI or provides a different deployment mechanism, a PACK2 probe could be reconsidered, but it is not justified for CLI `0.0.55`.

## Base44 support questions, if platform confirmation is still needed

If ownership wants external confirmation, ask Base44:

1. Can one backend function import a TypeScript file from a sibling directory under `base44/functions`?
2. Does `functions deploy <name>` bundle all transitive local imports?
3. Must imports remain inside the selected function directory?
4. Are modules under `base44/functions/_shared` supported?
5. Will a directory without `entry.ts` be ignored as a deployable function?
6. Are imports outside `functionsDir` supported?
7. Does the deployment bundle flatten modules or upload a file graph?
8. What shared-code structure does Base44 officially recommend?

Do not include credentials, app tokens, private deployment payloads, or customer data.

## Rejected duplication approaches

PACK1 does not recommend:

- manually copied helper implementations;
- generated function-local copies;
- symlinked helper files;
- duplicated key lists;
- independent resolver variants.

Those approaches would preserve deployment compatibility but recreate source-of-truth drift. Any generated-copy strategy would require a separate explicit architecture decision and is not approved by G48A.

## Harness result

Harness:

```text
scripts/migration/run-g48b-pack1-shared-function-module-packaging-tests.mjs
```

Result:

```text
success=true
classification=shared_function_module_packaging_unsupported
cli_version=0.0.55
cli_function_payload_type=json_file_graph_entry_files_automations
case_a_function_local_supported=true
case_b_functions_root_shared_supported=false
case_c_outside_functions_root_supported=false
```

The harness:

- captures CLI version;
- locates the deploy implementation;
- classifies function discovery;
- verifies function-local helper inclusion;
- verifies functions-root shared helper exclusion;
- verifies outside-functions-root helper exclusion;
- verifies no deploy command is invoked;
- verifies no credentials are printed;
- verifies no production function tree is modified;
- confirms no writes/providers/notifications/Hub mutation/live records.

## No-write/no-publish confirmation

Confirmed non-effects:

- no production runtime function changed;
- no customer function changed;
- no schemas/entities changed;
- no UI changed;
- no Base44 publish;
- no Builder publish;
- no production function deploy;
- no records mutated;
- no Stripe call;
- no Shopify call;
- no Hub mutation;
- no provider call;
- no notification;
- no sync/repair/replay;
- no logs/queues created.

The only live-network action was a read-only `functions pull` into `/tmp` for one existing deployed function.

## Next package decision

Because Case B is unsupported by the installed CLI deploy path, do not resume G48B implementation with a sibling shared module.

Do not copy the resolver.

Recommended next step:

```text
G48C — production and compliance lifecycle/read-model consolidation
```

G48C should avoid depending on shared Base44 function modules unless Base44 provides a new packaging contract.

If shared code remains important, the next architecture decision should evaluate a separately approved generated-copy strategy or a platform-supported shared package mechanism. That is outside G48B-PACK1 scope.
