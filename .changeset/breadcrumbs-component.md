---
"@groot/ui": minor
"@groot/shell": patch
"@groot/jobs": patch
"@groot/web": patch
---

Render every breadcrumb through one component, so a list item can't land
inside another one again (40a8092, e017985).

- `@groot/ui`: new `Breadcrumbs` in `@groot/ui/breadcrumb`. Its children are
  the ancestor crumbs, each a link or button element, and `page` is the
  current page: `<Breadcrumbs page={job.name}><Link to="/jobs">Jobs</Link></Breadcrumbs>`.
  It places the list items and separators. Every existing breadcrumb export
  stays.
- Lint rule R5a now fails an import of `BreadcrumbItem` or
  `BreadcrumbSeparator` from `@groot/ui/breadcrumb` or `@groot/ui` outside
  `packages/ui`, with a message naming `Breadcrumbs`.
- `@groot/shell` (Storage) and `@groot/jobs` (JobDetail) render their
  breadcrumbs with `Breadcrumbs`. The markup is unchanged.
- `@groot/web`: the skill, connection and connection tool pages use
  `Breadcrumbs`. The skill page's `Skills` crumb is now a real link with an
  `href`, so it can be reached with Tab and opened in a new tab.
