import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Stack,
  Typography,
  CircularProgress,
  Divider,
  Tooltip,
  IconButton,
  Alert,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import BackspaceIcon from '@mui/icons-material/Backspace';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useAppStore } from '../store/appStore';

/**
 * AI 面板（P0-3 / P0-5）：自然语言输入 → 生成 SQL → 展示 → 回填编辑器 / 复制。
 * 注意：生成的 SQL 仅回填到编辑器，绝不自动执行（满足 P0-5）。
 */
export default function AiPanel(): JSX.Element {
  const generateAi = useAppStore((s) => s.generateAi);
  const aiResult = useAppStore((s) => s.aiResult);
  const aiLoading = useAppStore((s) => s.aiLoading);
  const aiError = useAppStore((s) => s.aiError);
  const current = useAppStore((s) => s.currentConnection);
  const setSql = useAppStore((s) => s.setSql);

  const [prompt, setPrompt] = useState('');

  const handleSend = () => {
    if (!prompt.trim()) return;
    void generateAi(prompt.trim());
  };

  const handleFill = () => {
    if (aiResult) setSql(aiResult);
  };

  const handleCopy = async () => {
    if (aiResult) {
      try {
        await navigator.clipboard.writeText(aiResult);
      } catch {
        // 忽略剪贴板异常
      }
    }
  };

  return (
    <Box className="flex flex-col h-full bg-white">
      <Box className="p-3 border-b border-gray-200">
        <Typography variant="subtitle2" className="font-semibold text-gray-700 mb-2">
          AI 助手（自然语言生成 SQL）
        </Typography>
        <TextField
          multiline
          minRows={3}
          maxRows={6}
          fullWidth
          size="small"
          placeholder="描述你的需求，例如：查询最近 7 天注册的用户（已选数据库连接时会带上表结构）"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Button
          className="mt-2"
          variant="contained"
          fullWidth
          startIcon={aiLoading ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
          onClick={handleSend}
          disabled={aiLoading || !prompt.trim()}
        >
          {aiLoading ? '生成中…' : '发送'}
        </Button>
      </Box>

      <Divider />

      <Box className="flex-1 overflow-auto p-3">
        {aiError && (
          <Alert severity="error" className="mb-2">
            {aiError}
          </Alert>
        )}
        {!aiResult && !aiError && (
          <Typography className="text-gray-400 text-sm">
            生成的 SQL 将显示在此处，可一键回填到编辑器后手动执行。
          </Typography>
        )}
        {aiResult && (
          <Box>
            <Stack direction="row" spacing={1} className="mb-2" alignItems="center">
              <Typography variant="body2" className="font-semibold text-gray-600">
                生成结果
              </Typography>
              <Box className="flex-1" />
              <Tooltip title="回填编辑器（不自动执行）">
                <Button size="small" variant="outlined" startIcon={<BackspaceIcon />} onClick={handleFill}>
                  回填编辑器
                </Button>
              </Tooltip>
              <Tooltip title="复制">
                <IconButton size="small" onClick={handleCopy}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Box
              component="pre"
              className="bg-gray-900 text-gray-100 rounded p-3 text-xs overflow-auto whitespace-pre-wrap"
            >
              {aiResult}
            </Box>
            <Alert severity="info" className="mt-2" variant="outlined">
              AI 生成的 SQL 仅作建议，需点击「执行」才会真正运行。
            </Alert>
          </Box>
        )}
      </Box>
    </Box>
  );
}
