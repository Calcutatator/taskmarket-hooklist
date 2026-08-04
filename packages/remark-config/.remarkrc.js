module.exports = {
  plugins: [
    // MUST stay first and must not be removed. `remark --output` -- which is what
    // `pnpm format:write` and `make format-fix docs` run -- rewrites files in
    // place, and without this plugin remark does not recognise YAML frontmatter
    // at all. It parses the opening `---` as a thematic break and the closing one
    // as a setext heading underline, and rewrites the block as `***` followed by
    // a `## description:` heading. That silently destroys the frontmatter of
    // every file it touches, which for `apps/docs/src/pages/` is the title,
    // description and sidebar metadata Vocs builds each page from.
    'remark-frontmatter',
    'remark-preset-lint-consistent',
    'remark-preset-lint-markdown-style-guide',
    'remark-preset-lint-recommended',
    // Style belongs to markdownlint (`pnpm lint:check`), which these docs have
    // always been written against. These rules are the markdown-style-guide
    // preset's opinions where they disagree with markdownlint or with how this
    // repo demonstrably writes prose -- 1356 warnings' worth, none of them
    // correctness, on docs nobody considers malformed. They are off so that
    // `format:check` reports something worth reading rather than a wall nobody
    // acts on. Turning any back on means committing to the cleanup behind it.
    ['remark-lint-maximum-line-length', false],
    ['remark-lint-rule-style', false],
    ['remark-lint-list-item-spacing', false],
    ['remark-lint-ordered-list-marker-value', false],
    ['remark-lint-unordered-list-marker-style', false],
    ['remark-lint-maximum-heading-length', false],
    ['remark-lint-no-emphasis-as-heading', false],
  ],
};
