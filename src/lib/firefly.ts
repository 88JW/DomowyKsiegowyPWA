const SOURCE_ACCOUNT_NAME = 'Mia Software';

export function getFireflyConfig() {
  const fireflyUrl = process.env.FIREFLY_API_URL;
  const fireflyToken = process.env.FIREFLY_API_TOKEN;

  if (!fireflyUrl || !fireflyToken) {
    throw new Error('Brak konfiguracji Firefly API w zmiennych srodowiskowych');
  }

  return {
    fireflyUrl,
    fireflyToken,
    sourceAccountName: SOURCE_ACCOUNT_NAME,
  };
}