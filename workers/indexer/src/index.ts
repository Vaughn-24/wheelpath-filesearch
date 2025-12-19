export async function main() {
  // Placeholder: indexer entrypoint (Cloud Run worker)
  // Will: consume doc.ingested, chunk with LlamaIndex, upsert to Google Cloud Vector Search
  // For M1, we only scaffold.
  // eslint-disable-next-line no-console
  console.log('indexer worker online');
}

if (require.main === module) {
  main();
}
