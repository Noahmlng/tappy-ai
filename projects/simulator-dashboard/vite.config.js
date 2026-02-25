import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = (
    env.MEDIATION_CONTROL_PLANE_API_PROXY_TARGET
    || env.SIMULATOR_API_PROXY_TARGET
    || 'http://127.0.0.1:3100'
  )

  return {
    plugins: [vue(), vueJsx(), vueDevTools()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      extensions: ['.mjs', '.js', '.jsx', '.json', '.vue'],
    },
    server: {
      port: 3002,
      proxy: {
        '^/api(?:/|$)': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
