import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'js/main.js',
  output: {
    file: 'js/bundle.js',
    format: 'es'
  },
  plugins: [
    resolve(),
    commonjs()
  ]
};
