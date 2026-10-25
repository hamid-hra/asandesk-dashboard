/// <reference types="vite/client" />

declare module 'virtual:asan-proto-schema' {
  const schema: Record<string, { f: [string, number, string, string | null, number, number, string | null][] }>;
  export default schema;
}
