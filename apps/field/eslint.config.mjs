import base from '@repo/config/eslint';

export default [...base, { ignores: ['expo-env.d.ts', '.expo/**'] }];
