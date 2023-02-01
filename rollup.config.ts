import fs from 'node:fs'

import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))

export default {
  input: 'src/main.ts',
  output: [
    {
      file: packageJson.main,
      format: 'umd',
      sourcemap: true,
      name: 'ReverseGeocoder',
      globals: {
        'cross-fetch': 'window.fetch',
      },
    },
    // {
    //   file: packageJson.module,
    //   format: 'esm',
    //   sourcemap: true,
    // },
  ],
  plugins: [
    commonjs({
      requireReturnsDefault: true,
    }),
    typescript(),
    resolve(),
  ],
  external: ['cross-fetch'],
}
