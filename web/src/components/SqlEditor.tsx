import { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { Box, Button, Stack, Switch, FormControlLabel, Tooltip } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import { useAppStore } from '../store/appStore';

/**
 * SQL 编辑器（P0-2 / P1-5）：CodeMirror 高亮 + 执行 / 清空 + 「取消限制」开关。
 * 执行结果由 store.runQuery 触发（默认 LIMIT 1000，开关置 unlimited）。
 */
export default function SqlEditor(): JSX.Element {
  const sql = useAppStore((s) => s.sql);
  const setSql = useAppStore((s) => s.setSql);
  const runQuery = useAppStore((s) => s.runQuery);
  const loading = useAppStore((s) => s.queryLoading);
  const current = useAppStore((s) => s.currentConnection);
  const [unlimited, setUnlimited] = useState(false);

  const handleRun = () => {
    void runQuery({ unlimited });
  };

  const handleClear = () => setSql('');

  return (
    <Box className="flex flex-col h-full">
      <Box className="flex items-center px-3 py-2 border-b border-gray-200 bg-white">
        <Button
          variant="contained"
          size="small"
          startIcon={loading ? undefined : <PlayArrowIcon />}
          onClick={handleRun}
          disabled={loading || !current}
        >
          {loading ? '执行中…' : '执行'}
        </Button>
        <Tooltip title="清空编辑器">
          <Button size="small" className="ml-2" startIcon={<ClearAllIcon />} onClick={handleClear}>
            清空
          </Button>
        </Tooltip>
        <Box className="flex-1" />
        <FormControlLabel
          control={<Switch size="small" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />}
          label="取消限制（不追加 LIMIT 1000）"
          className="mr-2"
        />
      </Box>
      <Box className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={sql}
          height="100%"
          extensions={[sqlLang()]}
          onChange={setSql}
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
          placeholder="在此输入 SQL，例如：SELECT * FROM users LIMIT 10;"
        />
      </Box>
    </Box>
  );
}
