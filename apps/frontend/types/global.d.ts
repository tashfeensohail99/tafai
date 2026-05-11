// Declare CSS modules so TypeScript doesn't complain about CSS imports
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
