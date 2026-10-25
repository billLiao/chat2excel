# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-02-01

### Added
- **Agent Skills System**: Modular skill system for AI Agent capabilities
  - Skill registry for managing AI capabilities
  - Built-in skills: Data Analysis, Visualization, Data Export
  - Skill matching based on user intent and keywords
  - Dynamic tool assembly for AI Agent
  - Support for custom skill development
- **Skill Management UI**
  - Visual skill management interface in Settings
  - Enable/disable skills with toggle switches
  - Skill categorization (Data Analysis, Visualization, Data Export, Custom)
  - Search and filter skills
  - Skill statistics dashboard (total, enabled, built-in, custom)
- **Skill Import & Export**
  - Import skills from SKILL.md files
  - Import skills from folders containing SKILL.md
  - Support for Agent Skills standard format (agentskills.io)
- **Skill Editor**
  - Edit SKILL.md content directly in the app
  - Real-time skill content validation
  - Warning when editing built-in skills
  - Delete custom skills
- **Multi-language Support for Skills**
  - Full i18n support for skill management interface
  - English and Chinese translations
- **SQL Query Functionality**
    - Data page now supports SQL query functionality
    - SQL editor with syntax highlighting and multi-line input support
    - Query execution with Ctrl/Cmd + Enter shortcut
    - Query history (saves last 10 queries)
    - Query result display in table format with row count statistics
    - Internationalization support for SQL query features (English/Chinese)
    - **SQL Query Quick Insert Buttons**
        - Insert current table name button for easy table reference
        - Quick template buttons: SELECT *, SELECT COUNT, SELECT WHERE
        - Smart cursor positioning after template insertion
        - Context-aware buttons disabled when no table selected

### Changed
- Enhanced Agent Core to support dynamic skill-based tool assembly
- Improved system prompt generation with skill context injection
- Extended IPC communication for skill management APIs

### Technical
- Added skill parser for SKILL.md files
- Implemented skill matcher for intent-based skill selection
- Created skill loader for file system operations
- Added skill registry for centralized skill management

## [0.1.0] - 2026-01-05

### Added
- Initial release of Chat2Excel.
- Natural language to SQL/DuckDB query engine.
- ECharts integration for automatic visualization.
- Excel and CSV file import support.
- Multi-language support (i18n).
- Local database storage with DuckDB.
- Dark/Light mode UI.
