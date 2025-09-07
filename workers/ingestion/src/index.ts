export async function main() {
  // Placeholder: ingestion entrypoint (Cloud Run job)
  // Will: read GCS event or API-triggered payloads, detect type, normalize, publish doc.ingested
  // For M1, we only scaffold.
  // eslint-disable-next-line no-console
  console.log('ingestion worker online');
}

if (require.main === module) {
  main();
}
