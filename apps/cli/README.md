# SkillsCat CLI

Install a published skill using its exact slug:

```sh
npx skillscat add <slug>
```

## Install local skills

```sh
npx skillscat install .
```

The CLI recursively finds `SKILL.md` files in the current directory, validates
their `name` and `description` frontmatter, and displays a table with names,
paths, and descriptions. Select skills and agents with Space, then press Enter
and confirm the destinations. Installations default to the current project;
use `--global` to install to your user directories.

Scripts, templates, references, and other companion files are included. Nested
skills are separate bundles. Dependency, build, Git, and cache directories and
symbolic links are skipped. Discovery and bundle size limits keep scans bounded.
Tracked installation copies are excluded from recursive discovery, so repeating
`install .` uses the original sources. A directory matching a registry slug is
only treated as local with an explicit path such as `./owner/skill`.
If two selected skills resolve to the same destination, choose one by its
relative path. Existing different content requires confirmation or `--force`.
Overlapping destinations are rejected. Local writes are prepared in a temporary
directory; write failures leave the original bundle intact, and failed directory
replacement restores the previous version. If filesystem permissions prevent
restoration, the CLI reports where the original backup is preserved.

```sh
# Inspect without installing
npx skillscat install . --list

# Select names or relative source paths and agents explicitly
npx skillscat install . --skill code-review templates/docs --agent claude codex

# Install all discovered skills without prompts
npx skillscat install . --agent codex cursor --yes

# Install from another directory to global agent directories
npx skillscat install ./my-skills --global-agent claude codex
```

Without `--agent`, interactive installs offer all supported agents and preselect
detected agents, falling back to `.agents`. With `--yes`, the CLI uses those
detected targets automatically; different existing content is skipped unless
`--force` is supplied. `add`, `install`, and `i` accept the same local sources.

Local installs are tracked alongside registry installs. `skillscat update`
refreshes them from their original local directories, including changed or
removed companion files. Keep those directories available for future updates.

After installation, logged-in users can choose skills to publish to SkillsCat.
Each selected skill uses the existing metadata preview, visibility rules, and
publishing confirmation. The interactive guide publishes the installed file
snapshot, keeping excluded build files and subsequent source edits out of that
submission. Uploads accept UTF-8 text bundles with up to 50 files, 512 KiB per
file, and 5 MiB in total; skills outside these limits remain installed locally.
Declining leaves the installation complete. `--yes`
only automates installation and prints a `skillscat publish <path>` next step
for logged-in users; it never publishes automatically. Local installation does
not send registry installation statistics or submit repositories for indexing.
Publishing errors are reported while other selected skills can still be
published; successful local installations remain available.

## CLI interaction style

Human-facing commands share the presentation helpers in `src/utils/core/ui.ts`
and selection/confirmation helpers in `src/utils/core/prompts.ts`:

- Lists and installation plans use the same titled tables. At narrow terminal
  widths, long rows switch to labeled fields so names, slugs, source paths, and
  installation destinations stay complete and copyable.
- Metadata and previews use the same bordered panels. Panels wrap text by
  terminal columns and keep Chinese text, combining characters, and emoji intact.
- Single selection uses arrow keys; multiple selection adds Space to toggle.
  Both require an interactive terminal and use Inquirer's standard cursor, accent,
  and keyboard guidance. In scripts, pass explicit selection flags such as
  `--yes`, `--skill`/`--agent`, or `--reason` as appropriate for the command.
- Confirmations show `[Y/n]` or `[y/N]`. Only empty input with a declared yes
  default, `y`, or `yes` approves an action. Publishing remains opt-in; unpublishing
  retains exact-slug confirmation unless `--yes` is explicitly supplied.
- Success and information go to stdout; warnings and errors go to stderr, using
  shared symbols and colors. Cancellation is an information state. Progress
  animates in a terminal and uses static lines in redirected output.
- Ctrl+C in a selection or confirmation exits as cancellation without performing
  the pending action. Installations completed before cancellation remain tracked;
  an input stream closing unexpectedly remains an error.
- Action hints use dim explanatory text and accented commands. New native
  install examples use exact published slugs.

Use these helpers for new commands instead of introducing another prompt or
status format. Document output from `view --output html|markdown` and values
from `config get` retain their plain output for piping.
