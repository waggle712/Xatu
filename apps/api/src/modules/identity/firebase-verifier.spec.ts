import { FirebaseAdminVerifier, InvalidFirebaseTokenError } from './firebase-verifier.js';

describe('FirebaseAdminVerifier', () => {
  it('rejects a token that is not a Firebase ID token', async () => {
    await expect(new FirebaseAdminVerifier().verify('not-a-token')).rejects.toBeInstanceOf(
      InvalidFirebaseTokenError,
    );
  });
});
