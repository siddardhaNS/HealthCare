// The tokens package is the one place raw colours and font names are allowed.
import base from '@repo/config/eslint';

export default [...base, { rules: { 'no-restricted-syntax': 'off' } }];
