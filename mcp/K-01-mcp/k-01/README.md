# K-01: Universal Document & Codebase Intelligence MCP Server

K-01 gives any MCP-compatible AI agent the ability to **fully, reliably analyse massive documents and large codebases** — with zero content overlooked.

58 tools. 12 prompt templates. Offline-first. One `npm install`.

---

## What K-01 Does

- **Ingest** PDFs, DOCX, TXT, Markdown, HTML, and entire codebases
- **Navigate** document structure (headings, sections, line ranges) and code (file trees, symbols, call graphs)
- **Analyse** with persistent, incremental analysis — read → analyse → save → resume later
- **Build knowledge graphs** — entities, relationships, communities (LightRAG-inspired)
- **Recursive deep analysis** — RLM-inspired decomposition for large documents with hierarchical RAPTOR summaries
- **Cross-source synthesis** — compare, find contradictions/agreements across multiple sources
- **Export** standalone reports (Markdown, JSON, GraphML, CSV)

---

## Quick Start

### Prerequisites

- **Node.js** >= 18 (`node --version` to check)
- **Git**

### 1. Clone & Install

```bash
git clone https://github.com/netflypsb/K-01.git
cd K-01/k-01
npm install
```

> `npm install` automatically compiles TypeScript via the `prepare` script. If it fails, run `npm run build` manually.

### 2. Configure Your MCP Client

Add K-01 to your MCP client's configuration. **Replace `<FULL_PATH_TO_K-01>` with the absolute path where you cloned the repo.**

#### Windsurf IDE

Edit `C:\Users\<YOU>\.codeium\windsurf\mcp_config.json` (Windows) or `~/.codeium/windsurf/mcp_config.json` (macOS/Linux):

```json
{
  "mcpServers": {
    "k-01": {
      "command": "node",
      "args": ["<FULL_PATH_TO_K-01>/k-01/dist/server.js"]
    }
  }
}
```

#### Google Gemini CLI / Antigravity

Edit `C:\Users\<YOU>\.gemini\antigravity\mcp_config.json` (Windows) or `~/.gemini/antigravity/mcp_config.json` (macOS/Linux):

```json
{
  "mcpServers": {
    "k-01": {
      "command": "node",
      "args": ["<FULL_PATH_TO_K-01>/k-01/dist/server.js"]
    }
  }
}
```

#### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "k-01": {
      "command": "node",
      "args": ["<FULL_PATH_TO_K-01>/k-01/dist/server.js"]
    }
  }
}
```

#### Cursor / VS Code (Cline, Continue, etc.)

Check your IDE's MCP server settings. The configuration is always the same pattern:

```json
{
  "command": "node",
  "args": ["<FULL_PATH_TO_K-01>/k-01/dist/server.js"]
}
```

#### Other MCP Clients

Any MCP client that supports **stdio transport** can run K-01. The server binary is:

```
node <path-to-repo>/k-01/dist/server.js
```

> **Note for AI agents**: If you have direct access to the MCP configuration file, update it programmatically. If not, instruct the user to manually add the configuration above, replacing `<FULL_PATH_TO_K-01>` with the actual clone location.

### 3. Restart Your MCP Client

After updating the config, restart your IDE / MCP client so it picks up the new server.

### 4. Start Using K-01

Prompt your AI agent:

> "Use k01_list_sources to verify K-01 is connected, then k01_ingest_document to analyse a file."

---

## Agent Setup Prompt

Copy-paste this to any AI agent to set up K-01 automatically:

> **Clone and set up the K-01 MCP server. Follow these steps exactly:**
>
> 1. Clone the repo: `git clone https://github.com/netflypsb/K-01.git`
> 2. Install and build: `cd K-01/k-01 && npm install`
> 3. Add K-01 to the MCP configuration. The server command is `node` with argument `<absolute-path-to-K-01>/k-01/dist/server.js`. If you can access the MCP config file directly, update it. If not, tell me the exact JSON to add and where.
> 4. Verify: after restart, call `k01_list_sources` to confirm the server is running.

---

## Full Tool Reference

### Ingestion & Navigation (Phase 1)

| Tool | Description |
|------|-------------|
| `k01_ingest_document` | Ingest PDF, DOCX, TXT, MD, HTML → structured navigation |
| `k01_ingest_project` | Ingest codebase directory → file tree + symbol index |
| `k01_get_structure` | Get document outline or project file tree |
| `k01_read_section` | Read a specific document section by ID |
| `k01_read_range` | Read a line range from document or project file |
| `k01_read_file` | Read a full file from an ingested project |
| `k01_search` | Text/regex search within document or project |
| `k01_list_sources` | List all ingested documents and projects |
| `k01_get_info` | Get detailed metadata for a source |
| `k01_delete_source` | Delete a source and all associated data |

### Analysis & Persistence (Phase 2)

| Tool | Description |
|------|-------------|
| `k01_save_analysis` | Save analysis for a scope (section, file, etc.) |
| `k01_get_analysis` | Retrieve saved analysis |
| `k01_list_analyses` | List all analyses for a source |
| `k01_update_analysis` | Update existing analysis |
| `k01_delete_analysis` | Delete an analysis entry |
| `k01_start_session` | Start a tracked analysis session |
| `k01_get_session_progress` | Get session progress |
| `k01_update_session` | Update session state |
| `k01_compare_sections` | Compare two sections side-by-side |

### Structural Intelligence (Phase 3)

| Tool | Description |
|------|-------------|
| `k01_get_symbols` | Get code symbols (functions, classes, exports) via Tree-sitter |
| `k01_get_call_graph` | Get call graph for a function |
| `k01_get_dependencies` | Get file dependencies (imports/exports) |
| `k01_get_impact` | Impact analysis — what depends on this symbol? |
| `k01_get_parser_status` | Check available parsers (Tree-sitter, PDF, etc.) |
| `k01_semantic_search` | Semantic similarity search with embeddings |
| `k01_configure_embeddings` | Configure embedding provider |
| `k01_build_embeddings` | Build embedding index for a source |

### Knowledge Graph (Phase 4)

| Tool | Description |
|------|-------------|
| `k01_build_graph` | Extract entities and relationships from a source |
| `k01_get_entities` | List entities in the knowledge graph |
| `k01_get_relationships` | List relationships between entities |
| `k01_get_entity_detail` | Full detail for a specific entity |
| `k01_get_communities` | Get thematic communities (Louvain clustering) |
| `k01_get_community_detail` | Detail for a specific community |
| `k01_find_path` | Find shortest path between two entities |
| `k01_search_graph` | Search the knowledge graph |
| `k01_link_sources` | Create cross-source entity links |
| `k01_configure_extraction` | Configure extraction mode (rule-based / LLM) |

### Recursive Analysis (Phase 5)

| Tool | Description |
|------|-------------|
| `k01_create_analysis_plan` | Decompose document into recursive task tree |
| `k01_get_analysis_plan` | View plan with progress |
| `k01_get_next_task` | Get next task (bottom-up execution) |
| `k01_complete_task` | Complete a task with analysis + confidence |
| `k01_get_summary_tree` | View hierarchical RAPTOR summary tree |
| `k01_query_at_level` | Query summaries at a specific abstraction level |
| `k01_get_plan_summary` | Human-readable progress report |
| `k01_reanalyse_task` | Re-open a task for re-analysis |

### Synthesis & Export (Phase 6)

| Tool | Description |
|------|-------------|
| `k01_create_collection` | Group sources for cross-source analysis |
| `k01_get_collection` | Get collection overview |
| `k01_cross_search` | Search across all sources in a collection |
| `k01_compare_treatments` | Compare how sources treat the same concept |
| `k01_find_contradictions` | Find conflicting information across sources |
| `k01_find_agreements` | Find corroborated information |
| `k01_generate_synthesis` | Generate cross-source synthesis report |
| `k01_export_report` | Export single-source report (Markdown / JSON) |
| `k01_export_graph` | Export knowledge graph (JSON / GraphML / CSV) |
| `k01_export_collection_report` | Export cross-source synthesis report |
| `k01_get_config` | View current configuration |
| `k01_set_config` | Update configuration |

---

## Prompt Templates (12)

| Prompt | Description |
|--------|-------------|
| `k01_analyse_document` | Systematic section-by-section document analysis |
| `k01_explore_codebase` | Systematic codebase architecture exploration |
| `k01_analysis_summary` | Generate summary of all analyses for a source |
| `k01_graph_exploration` | Explore knowledge graph: entities, communities, paths |
| `k01_cross_source_synthesis` | Synthesise knowledge across two sources |
| `k01_recursive_deep_analysis` | Full recursive analysis with hierarchical summaries |
| `k01_targeted_deep_dive` | Zoom into specific areas using summary tree |
| `k01_full_book_analysis` | End-to-end book analysis workflow |
| `k01_multi_paper_synthesis` | Multi-paper research synthesis workflow |
| `k01_codebase_deep_understanding` | Comprehensive codebase understanding workflow |

---

## Supported File Types

| Type | Parser |
|------|--------|
| **PDF** | Marker CLI (`pip install marker-pdf`), MinerU, or basic text extraction |
| **DOCX** | mammoth (built-in) |
| **TXT / MD / MDX** | Native |
| **HTML** | Tag stripping with structure preservation |
| **Code** | 15+ languages via Tree-sitter (JS, TS, Python, Rust, Go, Java, C, C++, etc.) |

## Storage

All data is stored in `~/.k-01/`:
- `documents/` — ingested document content and structure
- `projects/` — project metadata and indices
- `exports/` — exported reports and graphs
- `k01.db` — SQLite database

---

## Architecture

```
MCP Client (Claude, Windsurf, Cursor, Gemini, etc.)
       │ stdio
       ▼
   K-01 MCP Server
       │
       ├── Ingestion Pipeline (PDF, DOCX, Code, etc.)
       ├── Document Store + Project Store (JSON + SQLite)
       ├── Analysis Store + Session Store
       ├── Structural Intelligence (Tree-sitter, Embeddings)
       ├── Knowledge Graph (Entities, Relationships, Communities)
       ├── Recursive Analysis Engine (RLM decomposition, RAPTOR summaries)
       ├── Cross-Source Synthesis Engine
       └── Export System (Markdown, JSON, GraphML, CSV)
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Server not found | Check the path in your MCP config points to `k-01/dist/server.js` |
| Build failed | Run `cd k-01 && npm run build` manually. Check Node.js >= 18. |
| No tools appearing | Restart your MCP client after config change |
| PDF parsing limited | Install Marker: `pip install marker-pdf` for full PDF support |
| Tree-sitter not working | It auto-downloads on first use. Check internet connection. |

## License

MIT
