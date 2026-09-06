import { build } from 'esbuild'
import { buildIcon } from './icon.mjs'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { mkdir, cp, copyFile, writeFile, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const out = 'desktop-build'
await mkdir(out, { recursive: true })
buildIcon(out)
await cp('migrations', join(out, 'migrations'), { recursive: true })
await cp('public', join(out, 'public'), { recursive: true })
const vendor = join(out, 'public/vendor')
await mkdir(join(vendor, 'fontawesome'), { recursive: true })
for (const [src, name] of [
  ['node_modules/axios/dist/axios.min.js', 'axios.min.js'],
  ['node_modules/chart.js/dist/chart.umd.js', 'chart.umd.js'],
  ['node_modules/echarts/dist/echarts.min.js', 'echarts.min.js']
]) await copyFile(src, join(vendor, name))
await cp('node_modules/@fortawesome/fontawesome-free/css', join(vendor, 'fontawesome/css'), { recursive: true })
await cp('node_modules/@fortawesome/fontawesome-free/webfonts', join(vendor, 'fontawesome/webfonts'), { recursive: true })
const css = await postcss([tailwindcss({
  content: ['./src/**/*.{ts,tsx}', './public/static/*.js'],
  safelist: [{ pattern: /^(bg|text|border)-(slate|gray|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|100|200|300|400|500|600|700|800|900|950)$/, variants: ['hover'] }]
})]).process('@tailwind base;\n@tailwind components;\n@tailwind utilities;', { from: undefined })
await writeFile(join(vendor, 'tailwind.css'), css.css)
await build({ entryPoints: ['desktop/service.ts'], outfile: join(out, 'service.cjs'), bundle: true, platform: 'node', target: 'node24', format: 'cjs', sourcemap: true, logLevel: 'info' })
// Ship third-party license texts alongside the local copies.
const licenses = []
for (const name of ['axios','chart.js','echarts','@fortawesome/fontawesome-free','tailwindcss','hono','@hono/node-server']) {
  const dir = join('node_modules', name)
  for (const file of (await readdir(dir)).filter(n => /^licen[sc]e(?:\.|$)/i.test(n))) {
    licenses.push(name + '\n' + await readFile(join(dir, file), 'utf8'))
  }
}
await writeFile(join(out, 'THIRD-PARTY-LICENSES.txt'), licenses.join('\n\n-----------------\n\n'))
console.log('Desktop backend, migrations and offline assets built.')
