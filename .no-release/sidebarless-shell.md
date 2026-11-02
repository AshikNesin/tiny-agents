Sidebarless app shell.

The sidebar and mobile top bar are gone app-wide; every page uses the
Grok-style floating top bar (circular back, title, profile circle) via
PageLayout/TopBar in @groot/shell. Nav rows move to ShellConfig.nav.
Internal/UI-only restructure of shell components with no published-API
removals (PageHeader/PageLayout props unchanged), so no release needed
beyond the shell minor below.
