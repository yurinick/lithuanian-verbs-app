import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'js/vfs-http-worker.js',
  output: {
    file: 'js/vfs-http-worker-bundle.js',
    format: 'es'
  },
  plugins: [
    resolve(),
    commonjs()
  ]
};
