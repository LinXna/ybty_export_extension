const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

function findFile(name) {
  const roots = [process.cwd(), path.join(process.cwd(), '导出结果')];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') stack.push(full);
        else if (entry.isFile() && entry.name === name) return full;
      }
    }
  }
  throw new Error(`找不到 ${name}`);
}

const root = protobuf.Root.fromJSON({ nested: {
  ApiResult: { fields: {
    code: { type: 'int32', id: 1 }, data: { type: 'bytes', id: 2 }
  } },
    Score: { fields: {
      score: { type: 'int32', id: 1 }, halfScore: { type: 'int32', id: 2 },
      redCard: { type: 'int32', id: 3 }, yellowCard: { type: 'int32', id: 4 },
      corner: { type: 'int32', id: 5 }, overTime: { type: 'int32', id: 6 }, penalty: { type: 'int32', id: 7 }
    } },
    Environment: { fields: {
      weather: { type: 'string', id: 1 }, pressure: { type: 'string', id: 2 },
      temperature: { type: 'string', id: 3 }, wind: { type: 'string', id: 4 },
      humidity: { type: 'string', id: 5 }, weatherId: { type: 'int32', id: 6 }
    } },
    Team: { fields: {
      id: { type: 'int32', id: 1 }, name: { type: 'string', id: 2 }, logo: { type: 'string', id: 3 },
      results: { rule: 'repeated', type: 'string', id: 4 }, jersey: { type: 'string', id: 5 },
      shortName: { type: 'string', id: 6 }, rank: { type: 'string', id: 7 }
    } },
    Competition: { fields: {
      id: { type: 'int32', id: 1 }, name: { type: 'string', id: 2 }, type: { type: 'int32', id: 3 },
      logo: { type: 'string', id: 4 }, shortName: { type: 'string', id: 5 }
    } },
    LiveData: { fields: {
      id: { type: 'int32', id: 1 }, statusId: { type: 'int32', id: 2 },
      homeScores: { type: 'Score', id: 3 }, awayScores: { type: 'Score', id: 4 },
      stats: { type: 'Stats', id: 7 }, odds: { type: 'Odds', id: 9 }
    } },
    Stats: { fields: {
      itemsList: { rule: 'repeated', type: 'StatItem', id: 1 }
    } },
    StatItem: { fields: {
      code: { type: 'int32', id: 1 }, home: { type: 'int32', id: 2 }, away: { type: 'int32', id: 3 },
      homeCoords: { rule: 'repeated', type: 'string', id: 4 }, awayCoords: { rule: 'repeated', type: 'string', id: 5 }
    } },
    Odds: { fields: {
      type1: { type: 'OddsItem', id: 1 }, type2: { type: 'OddsItem', id: 2 },
      type3: { type: 'OddsItem', id: 3 }, type4: { type: 'OddsItem', id: 4 }
    } },
    OddsItem: { fields: {
      odd1: { type: 'string', id: 1 }, odd2: { type: 'string', id: 2 }
    } },
    Detail: { fields: {
      id: { type: 'int32', id: 1 }, matchTime: { type: 'int32', id: 2 },
      homeTeam: { type: 'Team', id: 4 }, awayTeam: { type: 'Team', id: 5 },
      competition: { type: 'Competition', id: 6 }, environment: { type: 'Environment', id: 8 }
    } }
  }
});

function decodeApi(buffer) {
  const ApiResult = root.lookupType('ApiResult');
  return ApiResult.decode(buffer);
}

function bodyBuffer(content) {
  if (!content || !content.text) return null;
  return content.encoding === 'base64' ? Buffer.from(content.text, 'base64') : Buffer.from(content.text);
}

function removeLogos(value) {
  if (Array.isArray(value)) return value.map(removeLogos);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.toLowerCase().includes('logo'))
      .map(([key, item]) => [key, removeLogos(item)])
  );
}

const har = JSON.parse(fs.readFileSync(findFile('leisu_console_full.har'), 'utf8'));
const output = [];
for (const entry of har.log.entries) {
  const match = entry.request.url.match(/\/api\/v3\/f\/(d|vd|s)(?:\?|$)/);
  if (!match) continue;
  const buffer = bodyBuffer(entry.response.content);
  if (!buffer) continue;
  const api = decodeApi(buffer);
  const item = { kind: match[1], url: entry.request.url, code: api.code, dataBytes: api.data.length };
  if (api.code === 0) {
    const typeName = match[1] === 'd' ? 'Detail' : match[1] === 'vd' ? 'LiveData' : null;
    if (typeName) item.decoded = removeLogos(root.lookupType(typeName).toObject(
      root.lookupType(typeName).decode(api.data), { defaults: true }
    ));
  }
  output.push(item);
}
console.log(JSON.stringify(output, null, 2));
