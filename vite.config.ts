import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // Workaround: tonejs-mml-to-json dist/mml2ast.js uses a bare 'web-tree-sitter'
      // import instead of the relative './web-tree-sitter.js' path expected after the
      // library's fix-dist-imports build step. This alias redirects Vite and Vitest to
      // the bundled copy that ships with the library until the upstream issue is fixed.
      'web-tree-sitter': resolve(
        './node_modules/tonejs-mml-to-json/dist/web-tree-sitter.js',
      ),
    },
  },
  test: {
    server: {
      deps: {
        inline: ['tonejs-mml-to-json'],
      },
    },
  },
})
