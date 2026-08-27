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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import BackspaceIcon from '@mui/icons-material/Backspace';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useAppStore, setSkipWriteConfirm } from '../store/appStore';
import ResultTable from './ResultTable';
import WriteConfirmDialog from './WriteConfirmDialog';

/**
 * AI 面板（增量迭代）：自然语言输入 → 生成多条 SQL → 逐条卡片（执行/回填/复制）
 * → 全部执行（多语句，写操作前二次确认）→ 结果分节折叠展示。
 * 注意：生成的 SQL 仅回填到编辑器，绝不自动执行（满足 P0-5）。
 */
export default function AiPanel(): JSX.Element {
  const generateAi = useAppStore((s) => s.generateAi);
  const aiStatements = useAppStore((s) => s.aiStatements);
  const aiHint = useAppStore((s) => s.aiHint);
  const aiLoading = useAppStore((s) => s.aiLoading);
  const aiError = useAppStore((s) => s.aiError);
  const multiResult = useAppStore((s) => s.multiResult);
  const multiLoading = useAppStore((s) => s.multiLoading);
  const multiError = useAppStore((s) => s.multiError);
  const pending = useAppStore((s) => s.pendingWriteConfirm);
  const runMultiQuery = useAppStore((s) => s.runMultiQuery);
  const runSingleQuery = useAppStore((s) => s.runSingleQuery);
  const fillEditorWithStatements = useAppStore((s) => s.fillEditorWithStatements);
  const confirmWriteConfirm = useAppStore((s) => s.confirmWriteConfirm);
  const cancelWriteConfirm = useAppStore((s) => s.cancelWriteConfirm);

  const [prompt, setPrompt] = useState('');
  const [dontAskAgain, setDontAskAgain] = useState(false);
  // 事务执行开关（增量 P2-2）：开启后整批在同一连接上以事务执行，任一语句失败全部回滚
  const [txMode, setTxMode] = useState(false);

  const handleSend = () => {
    if (!prompt.trim()) return;
    void generateAi(prompt.trim());
  };

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(aiStatements.join(';\n'));
    } catch {
      // 忽略剪贴板异常
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 忽略剪贴板异常
    }
  };

  const handleConfirm = () => {
    if (dontAskAgain) setSkipWriteConfirm(true);
    setDontAskAgain(false);
    void confirmWriteConfirm();
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

        {aiStatements.length === 0 && !aiLoading && !aiError && (
          <Box>
            {aiHint ? (
              <Alert severity="info" variant="outlined">
                {aiHint}
              </Alert>
            ) : (
              <Typography className="text-gray-400 text-sm">
                生成的 SQL 将显示在此处，可一键回填到编辑器后手动执行。
              </Typography>
            )}
          </Box>
        )}

        {aiStatements.length > 0 && (
          <Box>
            <Stack direction="row" spacing={1} className="mb-2" alignItems="center">
              <Typography variant="body2" className="font-semibold text-gray-600">
                生成结果 · 共 {aiStatements.length} 条语句
              </Typography>
              <Box className="flex-1" />
              <Tooltip title="全部回填编辑器（不自动执行）">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<BackspaceIcon />}
                  onClick={() => fillEditorWithStatements()}
                >
                  全部回填
                </Button>
              </Tooltip>
              <Tooltip title="复制全部">
                <IconButton size="small" onClick={handleCopyAll}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>

            {/* 逐条语句卡片 */}
            <Stack spacing={1.5} className="mb-2">
              {aiStatements.map((stmt, idx) => (
                <Box key={idx} className="border border-gray-200 rounded overflow-hidden">
                  <Box
                    component="pre"
                    className="bg-gray-900 text-gray-100 p-2 text-xs overflow-auto whitespace-pre-wrap m-0"
                  >
                    {stmt}
                  </Box>
                  <Stack direction="row" spacing={1} className="p-2" alignItems="center">
                    <Button size="small" variant="contained" onClick={() => runSingleQuery(stmt)}>
                      执行
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => fillEditorWithStatements(stmt)}
                    >
                      回填
                    </Button>
                    <Tooltip title="复制">
                      <IconButton size="small" onClick={() => handleCopy(stmt)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Box>
              ))}
            </Stack>

            {/* 事务执行开关：任一语句失败时全部回滚，适合同一批写操作 */}
            <Stack direction="row" alignItems="center" className="mb-1.5">
              <Tooltip title="任一语句失败时全部回滚，适合同一批写操作">
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={txMode}
                      onChange={(e) => setTxMode(e.target.checked)}
                    />
                  }
                  label={<Typography variant="body2">事务执行</Typography>}
                />
              </Tooltip>
            </Stack>

            <Button
              variant="contained"
              color="primary"
              fullWidth
              onClick={() => runMultiQuery(txMode)}
              disabled={multiLoading}
              startIcon={multiLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {multiLoading ? '执行中…' : '全部执行'}
            </Button>

            {/* 多语句执行结果：分节折叠 + 成功/失败计数 */}
            {multiError && (
              <Alert severity="error" className="mt-3">
                {multiError}
              </Alert>
            )}
            {multiResult && (
              <Box className="mt-3">
                {multiResult.rolledBack === true && (
                  <Alert severity="warning" className="mb-2">
                    事务已回滚，本次执行的所有变更未生效。
                  </Alert>
                )}
                <Alert
                  severity={multiResult.errorCount > 0 ? 'warning' : 'success'}
                  variant="outlined"
                  className="mb-2"
                >
                  成功 {multiResult.successCount} / 失败 {multiResult.errorCount}
                </Alert>
                <Stack spacing={1}>
                  {multiResult.statements.map((item, i) => (
                    <Accordion key={i} defaultExpanded>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box className="flex items-center gap-2 w-full pr-2">
                          <Chip
                            size="small"
                            label={item.error ? '失败' : '成功'}
                            color={item.error ? 'error' : 'success'}
                          />
                          <Typography variant="body2" className="truncate flex-1" title={item.sql}>
                            {item.sql}
                          </Typography>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails>
                        {item.error ? (
                          <Typography className="text-red-600 whitespace-pre-wrap break-words text-sm">
                            {item.error}
                          </Typography>
                        ) : item.result ? (
                          <Box className="max-h-80 overflow-auto">
                            <ResultTable result={item.result} />
                          </Box>
                        ) : (
                          <Typography className="text-gray-400 text-sm">该语句无返回结果。</Typography>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Stack>
              </Box>
            )}

            <Alert severity="info" className="mt-3" variant="outlined">
              AI 生成的 SQL 仅作建议，需点击「执行」才会真正运行。
            </Alert>
          </Box>
        )}
      </Box>

      <WriteConfirmDialog
        open={!!pending}
        writeCount={pending?.writeCount ?? 0}
        connectionName={pending?.connectionName ?? ''}
        onConfirm={handleConfirm}
        onCancel={() => {
          setDontAskAgain(false);
          cancelWriteConfirm();
        }}
        onDontAskAgain={(checked) => setDontAskAgain(checked)}
      />
    </Box>
  );
}
