/**
 * normalizeText — applied to all imported content
 * Steps:
 *  1. Normalize line endings (\r\n, \r → \n)
 *  2. Remove NUL characters (U+0000)
 *  3. Strip trailing spaces/tabs per line
 *  4. Collapse 3+ consecutive newlines → 2
 *  5. Trim leading/trailing whitespace
 *
 * Edit-mode saves apply only steps 1 and 2 (pass editMode=true)
 */
export function normalizeText(text: string, editMode = false): string {
  // 1. Normalize line endings
  let result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // 2. Remove NUL characters
  result = result.replace(/\x00/g, '')

  if (editMode) return result

  // 3. Strip trailing spaces/tabs per line
  result = result.replace(/[ \t]+$/gm, '')

  // 4. Collapse 3+ consecutive newlines → 2
  result = result.replace(/\n{3,}/g, '\n\n')

  // 5. Trim leading/trailing whitespace
  result = result.trim()

  return result
}

