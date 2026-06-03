export interface FileMetadata {
  title: string;
  outLinks: string[];
  tags: string[];
  type: string;
}

// Parse YAML-like frontmatter key-value pairs
const parseFrontmatter = (yamlText: string) => {
  const result: Record<string, any> = {
    tags: [],
    aliases: []
  };
  
  const lines = yamlText.split('\n');
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    
    const key = match[1].trim();
    let val = match[2].trim();
    
    // Remove quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    
    if (key === 'tags') {
      if (val.startsWith('[') && val.endsWith(']')) {
        result.tags = val.slice(1, -1).split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean);
      } else if (val) {
        result.tags = [val];
      }
    } else if (key === 'aliases') {
      if (val.startsWith('[') && val.endsWith(']')) {
        result.aliases = val.slice(1, -1).split(',').map(a => a.trim().replace(/['"]/g, '')).filter(Boolean);
      } else if (val) {
        result.aliases = [val];
      }
    } else {
      result[key] = val;
    }
  }
  
  // Handle tag list format:
  // tags:
  //   - tag1
  //   - tag2
  const tagsBlockMatch = yamlText.match(/tags:\s*\n((?:\s*-\s*\S+\s*\n?)+)/);
  if (tagsBlockMatch) {
    const tagLines = tagsBlockMatch[1].split('\n');
    const tags: string[] = [];
    for (const tLine of tagLines) {
      const tMatch = tLine.match(/^\s*-\s*['"]?([^'"]+)['"]?/);
      if (tMatch) tags.push(tMatch[1]);
    }
    if (tags.length > 0) {
      result.tags = tags;
    }
  }
  
  return result;
};

// Extract wiki-links [[TargetName]] or [[TargetName|Alias]]
const extractWikiLinks = (content: string): string[] => {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].trim();
    if (target && !links.includes(target)) {
      links.push(target);
    }
  }
  return links;
};

// Main parser function
export function parseMarkdownMetadata(content: string, fileName: string): FileMetadata {
  const title = fileName.replace(/\.md$/i, '');
  let outLinks: string[] = [];
  let tags: string[] = [];
  let type = 'concept';
  
  // Match frontmatter (starts with --- and ends with ---)
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const fmData = parseFrontmatter(fmMatch[1]);
    if (fmData.tags) tags = fmData.tags;
    if (fmData.type) type = fmData.type;
    
    // Extract links only from the body content
    const bodyContent = content.substring(fmMatch[0].length);
    outLinks = extractWikiLinks(bodyContent);
  } else {
    // If no frontmatter, scan entire content for links
    outLinks = extractWikiLinks(content);
  }
  
  return {
    title,
    outLinks,
    tags,
    type
  };
}
