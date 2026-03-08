import { SITE_URL } from '$lib/seo/constants';

const MCP_URL = `${SITE_URL}/mcp`;
const REGISTRY_SEARCH_URL = `${SITE_URL}/registry/search`;
const REGISTRY_SEARCH_TOOL_URL = `${SITE_URL}/registry/search/tool`;
const REGISTRY_REPO_URL = `${SITE_URL}/registry/repo/<owner>/<repo>`;
const REGISTRY_SKILL_URL = `${SITE_URL}/registry/skill/<owner>/<name...>`;
const API_TOOL_SEARCH_URL = `${SITE_URL}/api/tools/search-skills`;
const API_TOOL_REPO_URL = `${SITE_URL}/api/tools/resolve-repo-skills`;
const API_TOOL_FILES_URL = `${SITE_URL}/api/tools/get-skill-files`;
const API_CATEGORIES_URL = `${SITE_URL}/api/categories`;
const API_SKILL_URL = `${SITE_URL}/api/skills/<slug>`;
const API_SKILL_FILES_URL = `${SITE_URL}/api/skills/<slug>/files`;
const API_SKILL_FILE_URL = `${SITE_URL}/api/skills/<slug>/file?path=<relative-path>`;
const API_SKILL_DOWNLOAD_URL = `${SITE_URL}/api/skills/<slug>/download`;
const HTML_SEARCH_URL = `${SITE_URL}/search`;
const HTML_TRENDING_URL = `${SITE_URL}/trending`;
const HTML_CATEGORIES_URL = `${SITE_URL}/categories`;
const HTML_SKILL_URL = `${SITE_URL}/skills/<owner>/<name...>`;

export function buildLlmTxt(): string {
  return `
TITLE: SkillsCat
CANONICAL_BASE_URL: ${SITE_URL}
PURPOSE: Discover, inspect, and install AI agent skills.

SUMMARY:
SkillsCat is a registry and website for AI agent skills.
Prefer the JSON endpoints below over scraping HTML pages.
Use the returned skill "slug" as the canonical identifier for follow-up requests and installs.
Send a descriptive User-Agent on machine requests; missing or generic scraping UAs may be blocked by abuse protection.

AGENT_CONTENT_MODEL:
- the primary install artifact is the full skill bundle, not just SKILL.md
- prefer /api/skills/<slug>/files or MCP get_skill_bundle when you need an install-ready skill
- MCP is an additional integration surface over the same data, not a separate content source

AGENT_TOOL_ENDPOINTS:
- search skills: POST ${API_TOOL_SEARCH_URL}
- resolve repo skills: POST ${API_TOOL_REPO_URL}
- get skill files: POST ${API_TOOL_FILES_URL}
- all tool endpoints also support GET for simple integrations

MCP_ENDPOINT:
- streamable HTTP MCP endpoint: POST ${MCP_URL}
- supported MCP tools: search_skills, resolve_repo_skills, get_skill_detail, get_skill_bundle
- prefer get_skill_bundle when you need the full skill bundle through MCP

CANONICAL_IDENTIFIER:
- slug format: owner/name or owner/path/to/skill
- use slug for machine workflows
- use /skills/<owner>/<name...> only when a human needs the webpage

PREFERRED_MACHINE_ENDPOINTS:
1. Search public skills:
   GET ${REGISTRY_SEARCH_URL}?q=<query>&limit=<n>
   Optional params: category, offset, include_private=true
   Notes: omit q to get trending skills; search results already include slug, stars, updatedAt, categories, owner, repo, platform.

1a. Agent-friendly search tool:
   POST ${API_TOOL_SEARCH_URL}
   JSON body: { query?, category?, limit?, offset?, includePrivate? }
   Returns the same result shape as /registry/search.
   Use this when an agent prefers JSON tool inputs over query strings.

1b. Legacy search tool alias:
   POST ${REGISTRY_SEARCH_TOOL_URL}
   Same behavior as /api/tools/search-skills.

2. List categories:
   GET ${API_CATEGORIES_URL}
   Use this before category-filtered search if you need valid category slugs.

3. Resolve all indexed skills in one repo:
   GET ${REGISTRY_REPO_URL}
   Optional param: path=<skill-directory-without-SKILL.md>
   Use this when the user already named a GitHub repo or when one repo contains multiple skills.

3a. Repo resolution tool:
   POST ${API_TOOL_REPO_URL}
   JSON body: { owner, repo, path? }
   Returns the same result shape as /registry/repo/<owner>/<repo>.

4. Read a skill summary and SKILL.md content by owner/name:
   GET ${REGISTRY_SKILL_URL}
   Use this for lightweight inspection when you only need the main skill document.

5. Read rich skill metadata by slug:
   GET ${API_SKILL_URL}
   Returns structured metadata, categories, file tree, visibility, source type, and recommendations.

6. Read all installable text files for a skill:
   GET ${API_SKILL_FILES_URL}
   Response shape: { folderName, files: [{ path, content }] }
   Preserve every files[].path exactly relative to the skill root.
   This is the preferred endpoint for full installs because many skills have companion files in addition to SKILL.md.

6a. Skill file tool:
   POST ${API_TOOL_FILES_URL}
   JSON body: { slug }
   Returns the same result shape as /api/skills/<slug>/files.

7. Read one text file from a skill:
   GET ${API_SKILL_FILE_URL}
   Use this for targeted fetches such as SKILL.md, templates, prompts, scripts, or config fragments.

8. Download fallback:
   GET ${API_SKILL_DOWNLOAD_URL}
   This currently only guarantees SKILL.md in the zip payload.
   Do not use it for full multi-file installs when /api/skills/<slug>/files is available.

HTML_PAGES:
- search page: ${HTML_SEARCH_URL}
- trending page: ${HTML_TRENDING_URL}
- categories page: ${HTML_CATEGORIES_URL}
- skill page: ${HTML_SKILL_URL}

SEARCH_AND_SELECTION_GUIDANCE:
1. If the user gives a natural-language task, start with /registry/search?q=<task>.
2. If the user gives a repo, start with /registry/repo/<owner>/<repo>.
3. Prefer exact or near-exact slug/name matches, then compare description, categories, stars, and updatedAt.
4. After choosing a candidate, fetch /api/skills/<slug> before install so you can inspect metadata and fileStructure.
5. For installation, always prefer /api/skills/<slug>/files over HTML scraping or zip download.

INSTALL_WITH_SKILLSCAT_CLI:
- no global install is required; prefer npx for one-off installs
- search: npx skillscat search "<query>"
- install by repo: npx skillscat add <owner>/<repo>
- install one skill from a multi-skill repo: npx skillscat add <owner>/<repo> --skill "<skill-name>"
- install from a direct GitHub URL: npx skillscat add https://github.com/<owner>/<repo>
- inspect repository skills: npx skillscat info <owner>/<repo>

OPENCLAW_WITH_SKILLSCAT_CLI:
If terminal access is available, prefer the SkillsCat CLI over manual file writes.
- run commands from the target workspace root so project-local installs land in ./skills when appropriate
- target OpenClaw only when needed with: npx skillscat add <owner>/<repo> --agent openclaw
- install a repo or root skill: npx skillscat add <owner>/<repo>
- install one skill from a multi-skill repo: npx skillscat add <owner>/<repo> --skill "<skill-name>"
- if <owner>/<repo> is not a single published slug but the repo exists in the registry, the CLI may prompt to install every indexed skill in that repo
- for private skills: run npx skillscat login first, then re-run the add command
- after install: start a new OpenClaw session so newly installed skills are discovered

OPENCLAW_INSTALL_GUIDE:
OpenClaw-compatible skills should be materialized as a folder containing SKILL.md and any companion files.
Preferred install targets:
- project-local: <workspace>/skills/<folderName>/
- global: ~/.openclaw/skills/<folderName>/

Recommended OpenClaw workflow:
1. Search via /registry/search or /registry/repo.
2. Select one skill slug.
3. Fetch /api/skills/<slug>/files.
4. Create the target directory using the returned folderName.
5. Write every returned file into that directory, preserving nested relative paths exactly.
6. Keep SKILL.md frontmatter unchanged. Do not strip metadata or rename files.
7. If only SKILL.md is needed for inspection, /registry/skill/<owner>/<name...> or /api/skills/<slug>/file?path=SKILL.md is enough, but /files remains the correct install source.
8. Start a new OpenClaw session after installation so the new skill is picked up reliably.

OPENCLAW_NOTES:
- prefer project-local installs when the skill is specific to the current repository
- use the global directory only for reusable personal skills
- if both local and global copies exist, prefer the local one for the active workspace
- preserve companion files such as templates, scripts, JSON, YAML, and prompt assets

AUTHENTICATION:
Public skills can be read anonymously.
Private skills require Authorization: Bearer <token>.
To include private skills in search, pass include_private=true.

DO_NOT:
- do not treat HTML pages as the primary integration surface
- do not assume /download contains every companion file
- do not flatten nested files returned by /api/skills/<slug>/files
- do not rewrite slugs; use them exactly as returned by the registry
`.trim();
}
