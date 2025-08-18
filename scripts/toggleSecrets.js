const fs = require('fs');
const path = require('path');

// Mode: 'inject' or 'restore'
const mode = process.argv[2] === 'restore' ? 'restore' : 'inject';

const pageProofPath = path.join(__dirname, '../src/services/PageProofAuthService.ts');
const hmacPath = path.join(__dirname, '../src/services/HmacService.ts');

// -------- PageProofAuthService toggle --------
function togglePageProofSecrets() {
  let content = fs.readFileSync(pageProofPath, 'utf8');

  const injectBlock = `    const applicationId = 'fortunebrands-sdk';
    const subscriptionKey = 'y0UTuMyLTlEJr6CUlSseHmYQTLwix44a';
    const email = 'Rola.Luo+sdk@fbin.com';
    const password = 'Rola123!';

    const client = new PageProof({
      options: {
        endpoint: process.env.PAGEPROOF_API_URL,
        applicationId,
        subscriptionKey,
      },
      adapters: [new NodeRequestAdapter(), new WorkerThreadsCryptoAdapter()],
    });

    loggerService.logger.info('PageProofAuthService: PageProof client created');

    let session = await this.getSessionWithCredentialCheck(email, password);

    try {
      if (!session) {
        loggerService.logger.info('PageProofAuthService: No valid session found (or credentials changed), logging in');
        session = await this.retryWithBackoff(
          () => client.accounts.login(email, password),
          'login',
        );
        client.setSession(session);
        await this.saveSessionWithCredentials(session, email, password);
        loggerService.logger.info('PageProofAuthService: New session logged in and saved');
      } else {
        client.setSession(session);
        loggerService.logger.info('PageProofAuthService: Session restored and set to client');
      }
    } catch (error) {
      loggerService.logger.error('PageProofAuthService: Login failed', { error });
      ErrorHandler.handleError(null, 500, 'PageProof login failed', error as Error);
      throw error;
    }

    return client;`;

  const originalBlock = `    const [applicationId, subscriptionKey, email, password] = await Promise.all([
      getSecretFromKeyVault('pageproofapplicationid'),
      getSecretFromKeyVault('pageproofsubscriptionKey'),
      getSecretFromKeyVault('pageproofemail'),
      getSecretFromKeyVault('pageproofpassword'),
    ]);

    const client = new PageProof({
      options: {
        endpoint: process.env.PAGEPROOF_API_URL,
        applicationId,
        subscriptionKey,
      },
      adapters: [new NodeRequestAdapter(), new WorkerThreadsCryptoAdapter()],
    });

    loggerService.logger.info('PageProofAuthService: PageProof client created');

    let session = await this.getSessionWithCredentialCheck(email, password);

    try {
      if (!session) {
        loggerService.logger.info('PageProofAuthService: No valid session found (or credentials changed), logging in');
        session = await this.retryWithBackoff(() => client.accounts.login(email, password), 'login');
        client.setSession(session);
        await this.saveSessionWithCredentials(session, email, password);
        loggerService.logger.info('PageProofAuthService: New session logged in and saved');
      } else {
        client.setSession(session);
        loggerService.logger.info('PageProofAuthService: Session restored and set to client');
      }
    } catch (error) {
      loggerService.logger.error('PageProofAuthService: Login failed', { error });
      ErrorHandler.handleError(null, 500, 'PageProof login failed', error as Error);
      throw error;
    }

    return client;`;

  const pattern =
    /private static async initializeClient\(\): Promise<PageProof> \{[\s\S]*?return client;\n\s*\}/;

  const replacement = `private static async initializeClient(): Promise<PageProof> {
    loggerService.logger.info('PageProofAuthService: Starting client initialization');

${mode === 'inject' ? injectBlock : originalBlock}
  }`;

  content = content.replace(pattern, replacement);
  fs.writeFileSync(pageProofPath, content, 'utf8');
  console.log(`✅ PageProofAuthService ${mode === 'inject' ? 'injected' : 'restored'}`);
}

// -------- HmacService toggle --------
function toggleHmacSecrets() {
  let content = fs.readFileSync(hmacPath, 'utf8');

  if (mode === 'inject') {
    content = content
      .replace(
        /this\.cachedSecret\s*=\s*await\s*getSecretFromKeyVault\([^)]*\);?/,
        `// this.cachedSecret = await getSecretFromKeyVault('hmac-secret-key');
        this.cachedSecret = '6413d2d9adfd7be563e664906534b051e4cf257ea7b5e653c68ef5028298ac60';`,
      )
      .replace(
        /const\s+actualSecret\s*=\s*await\s*this\.getSecret\(\);?/,
        `// const actualSecret = await this.getSecret();
        const actualSecret = '6413d2d9adfd7be563e664906534b051e4cf257ea7b5e653c68ef5028298ac60';`,
      );
  } else {
    content = content
      .replace(
        /\/\/\s*this\.cachedSecret\s*=\s*await\s*getSecretFromKeyVault\([^)]*\);[\s\S]*?;/,
        `this.cachedSecret = await getSecretFromKeyVault('hmac-secret-key');`,
      )
      .replace(
        /\/\/\s*const\s+actualSecret\s*=\s*await\s*this\.getSecret\(\);[\s\S]*?;/,
        `const actualSecret = await this.getSecret();`,
      );
  }

  fs.writeFileSync(hmacPath, content, 'utf8');
  console.log(`✅ HmacService ${mode === 'inject' ? 'injected' : 'restored'}`);
}

// -------- Execute Both Toggles --------
togglePageProofSecrets();
toggleHmacSecrets();
