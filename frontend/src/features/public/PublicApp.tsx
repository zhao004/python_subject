import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_MESSAGE,
  DEFAULT_STUDENT_FORM,
  FIELD_LIMITS,
  LEADERBOARD_FALLBACK_LIMIT,
  ONE_SECOND_MS,
  SITE_TITLE,
} from "./constants";
import {
  buildBoard,
  normalizeStudentForm,
  readRememberedStudentProfile,
  readRoute,
  removeRememberedStudentProfile,
  saveRememberedStudentProfile,
  validateStudentForm,
} from "./utils";
import {
  fetchDefaultQuestionBank,
  fetchLeaderboardBySlug,
  fetchQuizBySlug,
  submitAccessLog,
  submitScoreBySlug,
} from "./api";
import type {
  BoardItem,
  LeaderboardEntry,
  QuizData,
  RouteInfo,
  ScoreSubmissionResult,
  StudentForm,
} from "./types";
import { HomePage, LoadingPage } from "./components/Common";
import { QuizPage } from "./components/QuizPage";
import { LeaderboardPage } from "./components/Leaderboard";
import { StudentIdentityModal } from "./components/StudentIdentityModal";

interface PublicAppProps {
  route: RouteInfo;
  navigateTo: (path: string, replace?: boolean) => void;
}

/**
 * 公开端入口，处理默认题库跳转、答题页和排行榜页。
 *
 * 状态机说明：
 * - 计时器：首次点击卡片时 ensureTimerStarted 启动，全部配对完成时 stopTimer 固化
 * - 配对：点选第一张→点选异侧第二张→比对 pairId，错误回退，已配对拦截
 * - 身份确认：route.page==='quiz' 且 quiz 加载完成且未确认时弹出模态
 *
 * @param props route 由 App 通过 readRoute 解析传入，navigateTo 命令式跳转
 */
export function PublicApp({ route, navigateTo }: PublicAppProps) {
  const [homeLoading, setHomeLoading] = useState(route.page === "home");
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [leftItems, setLeftItems] = useState<BoardItem[]>([]);
  const [rightItems, setRightItems] = useState<BoardItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<BoardItem | null>(null);
  const [matchedPairIds, setMatchedPairIds] = useState<Set<number>>(() => new Set());
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [studentForm, setStudentForm] = useState<StudentForm>({ ...DEFAULT_STUDENT_FORM });
  const [rememberStudent, setRememberStudent] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [isIdentityConfirmed, setIsIdentityConfirmed] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerStopped, setTimerStopped] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lastResult, setLastResult] = useState<ScoreSubmissionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [publicError, setPublicError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);

  const slug = route.slug ?? "";
  const matchedCount = matchedPairIds.size;
  const score = quiz ? Math.round(matchedCount * quiz.points_per_pair) : 0;
  const totalPairs = quiz?.total_pairs ?? 0;
  const styleClass = quiz
    ? `public-style-${quiz.question_bank.submission_style}`
    : "public-style-classic";
  const shouldShowIdentityModal = route.page === "quiz" && quiz !== null && !isIdentityConfirmed;

  // 默认题库跳转
  useEffect(() => {
    if (route.page !== "home") {
      return undefined;
    }
    let isActive = true;

    async function loadDefaultBank() {
      setHomeLoading(true);
      try {
        const result = await fetchDefaultQuestionBank();
        if (!isActive) return;
        if (result.question_bank) {
          navigateTo(`/b/${encodeURIComponent(result.question_bank.slug)}`, true);
          return;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "请求失败");
      } finally {
        if (isActive) setHomeLoading(false);
      }
    }

    loadDefaultBank();
    return () => {
      isActive = false;
    };
  }, [navigateTo, route.page]);

  // slug 切换时重置状态
  useEffect(() => {
    if (!slug) return undefined;
    const timeoutId = window.setTimeout(() => {
      const rememberedProfile = readRememberedStudentProfile(slug);
      setStudentForm(rememberedProfile.form);
      setRememberStudent(rememberedProfile.rememberStudent);
      setIdentityError("");
      setIsIdentityConfirmed(false);
      setStartedAt(null);
      setElapsedSeconds(0);
      setTimerStopped(false);
      setLastResult(null);
      setMatchedPairIds(new Set());
      setSelectedItem(null);
      setMessage(DEFAULT_MESSAGE);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [slug]);

  // 加载题库数据
  useEffect(() => {
    if (route.page !== "quiz" && route.page !== "leaderboard") {
      return undefined;
    }
    let isActive = true;

    async function loadQuizData() {
      setIsLoading(true);
      setPublicError("");
      try {
        const quizData = await fetchQuizBySlug(route.slug!);
        if (!isActive) return;
        setQuiz(quizData);
        const board = buildBoard(quizData.word_pairs);
        setLeftItems(board.leftItems);
        setRightItems(board.rightItems);
      } catch (error) {
        if (isActive) {
          setPublicError(error instanceof Error ? error.message : "请求失败");
        }
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadQuizData();
    return () => {
      isActive = false;
    };
  }, [route.page, route.slug]);

  // 加载排行榜数据
  useEffect(() => {
    if (route.page !== "leaderboard" || !route.slug) {
      return undefined;
    }
    let isActive = true;

    async function loadLeaderboardData() {
      setIsLeaderboardLoading(true);
      try {
        const leaderboardData = await fetchLeaderboardBySlug(route.slug!, LEADERBOARD_FALLBACK_LIMIT);
        if (isActive) setLeaderboard(leaderboardData.entries);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "请求失败");
      } finally {
        if (isActive) setIsLeaderboardLoading(false);
      }
    }

    loadLeaderboardData();
    return () => {
      isActive = false;
    };
  }, [route.page, route.slug]);

  // 上报访问日志
  useEffect(() => {
    if ((route.page !== "quiz" && route.page !== "leaderboard") || !route.slug) {
      return;
    }
    submitAccessLog({
      page_path: route.path,
      question_bank_slug: route.slug,
    }).catch(() => {
      // 访问记录失败不能影响答题和排行榜浏览。
    });
  }, [route.page, route.path, route.slug]);

  // 计时器 interval
  useEffect(() => {
    if (startedAt === null || timerStopped) {
      return undefined;
    }
    const intervalId = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / ONE_SECOND_MS));
    }, ONE_SECOND_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [startedAt, timerStopped]);

  const selectedLookup = useMemo(() => {
    const items = [...leftItems, ...rightItems];
    return new Map(items.map((item) => [item.uid, item]));
  }, [leftItems, rightItems]);

  /** 设置操作提示 */
  const showStatus = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
  }, []);

  /** 首次作答时启动计时 */
  function ensureTimerStarted() {
    if (startedAt === null && !timerStopped) {
      setStartedAt(Date.now());
    }
  }

  /** 停止计时并固化当前耗时 */
  function stopTimer() {
    if (startedAt === null) {
      setTimerStopped(true);
      return;
    }
    setElapsedSeconds(Math.floor((Date.now() - startedAt) / ONE_SECOND_MS));
    setTimerStopped(true);
  }

  /** 处理学生信息输入 */
  function updateStudentForm(fieldName: keyof StudentForm, value: string) {
    setStudentForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value.slice(0, FIELD_LIMITS[fieldName]),
    }));
    if (identityError) {
      setIdentityError("");
    }
  }

  /** 确认入场身份信息 */
  function confirmStudentIdentity() {
    const validationMessage = validateStudentForm(studentForm);
    if (validationMessage) {
      setIdentityError(validationMessage);
      return;
    }
    const normalizedForm = normalizeStudentForm(studentForm);
    setStudentForm(normalizedForm);
    if (rememberStudent) {
      const isSaved = saveRememberedStudentProfile(slug, normalizedForm);
      if (!isSaved) {
        toast.error("浏览器无法记住学生信息，本次仍可继续答题");
      }
    } else {
      removeRememberedStudentProfile(slug);
    }
    setIdentityError("");
    setIsIdentityConfirmed(true);
    showStatus("身份信息已确认，点击卡片开始计时");
  }

  /** 重置当前测验状态并重新洗牌 */
  function resetGame() {
    if (!quiz) return;
    const board = buildBoard(quiz.word_pairs);
    setLeftItems(board.leftItems);
    setRightItems(board.rightItems);
    setSelectedItem(null);
    setMatchedPairIds(new Set());
    setStartedAt(null);
    setElapsedSeconds(0);
    setTimerStopped(false);
    setLastResult(null);
    showStatus("已重新随机排序，计时将在下一次点击时开始");
  }

  /** 尝试完成一次配对 */
  function attemptMatch(firstItem: BoardItem, secondItem: BoardItem) {
    const leftItem = firstItem.side === "left" ? firstItem : secondItem;
    const rightItem = firstItem.side === "right" ? firstItem : secondItem;

    if (leftItem.pairId !== rightItem.pairId) {
      setSelectedItem(null);
      showStatus(DEFAULT_MESSAGE);
      toast.error(`配对错误：${leftItem.text} 不是 ${rightItem.text}`);
      return;
    }

    const nextMatchedPairIds = new Set(matchedPairIds);
    nextMatchedPairIds.add(leftItem.pairId);
    setMatchedPairIds(nextMatchedPairIds);
    setSelectedItem(null);

    const nextMatchedCount = nextMatchedPairIds.size;
    if (quiz && nextMatchedCount === quiz.total_pairs) {
      stopTimer();
      showStatus("全部配对完成，可以提交成绩");
      toast.success("全部配对完成，可以提交成绩");
      return;
    }

    showStatus("配对成功，继续选择下一组");
    toast.success(`配对成功：${leftItem.text} 对应 ${rightItem.text}`);
  }

  /** 处理卡片点击 */
  function handleCardClick(item: BoardItem) {
    if (matchedPairIds.has(item.pairId)) {
      toast.error("这一项已经配对成功，请选择其他卡片");
      return;
    }
    ensureTimerStarted();
    if (selectedItem === null || selectedItem.side === item.side) {
      setSelectedItem(item);
      showStatus(item.side === "left" ? "已选左侧，请点击对应右侧" : "已选右侧，请点击对应左侧");
      return;
    }
    const activeSelectedItem = selectedLookup.get(selectedItem.uid);
    if (!activeSelectedItem || matchedPairIds.has(activeSelectedItem.pairId)) {
      setSelectedItem(null);
      showStatus(DEFAULT_MESSAGE);
      toast.error("上一次选择已失效，请重新选择");
      return;
    }
    attemptMatch(activeSelectedItem, item);
  }

  /** 提交当前成绩 */
  async function handleSubmitScore() {
    if (!quiz || quiz.total_pairs === 0) {
      toast.error("当前题库暂无题目，无法提交成绩");
      return;
    }
    const validationMessage = validateStudentForm(studentForm);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    setIsSubmitting(true);
    try {
      const normalizedForm = normalizeStudentForm(studentForm);
      if (rememberStudent) {
        saveRememberedStudentProfile(slug, normalizedForm);
      }
      const liveElapsedSeconds =
        startedAt === null || timerStopped
          ? elapsedSeconds
          : Math.floor((Date.now() - startedAt) / ONE_SECOND_MS);
      const result = await submitScoreBySlug(slug, {
        student_class: normalizedForm.studentClass,
        student_id: normalizedForm.studentId,
        student_name: normalizedForm.studentName,
        elapsed_seconds: liveElapsedSeconds,
        matched_pair_ids: Array.from(matchedPairIds),
      });
      setLastResult(result);
      setElapsedSeconds(liveElapsedSeconds);
      showStatus("成绩已提交，可继续练习或查看排行榜");
      toast.success(result.saved_as_best ? "成绩已保存为个人最佳记录" : "本次成绩未超过个人最佳记录");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "请求失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (route.page === "home") {
    return <HomePage isLoading={homeLoading} />;
  }

  if (route.page === "leaderboard") {
    return (
      <LeaderboardPage
        entries={leaderboard}
        isLoading={isLeaderboardLoading || isLoading}
        publicError={publicError}
        quiz={quiz}
        siteTitle={SITE_TITLE}
        styleClass={styleClass}
        onNavigateHome={() => navigateTo(`/b/${encodeURIComponent(slug)}`)}
      />
    );
  }

  return (
    <>
      <QuizPage
        elapsedSeconds={elapsedSeconds}
        isLoading={isLoading}
        isSubmitting={isSubmitting}
        lastResult={lastResult}
        leftItems={leftItems}
        matchedCount={matchedCount}
        matchedPairIds={matchedPairIds}
        message={message}
        publicError={publicError}
        quiz={quiz}
        rightItems={rightItems}
        score={score}
        selectedItem={selectedItem}
        studentForm={studentForm}
        styleClass={styleClass}
        totalPairs={totalPairs}
        onCardClick={handleCardClick}
        onNavigateLeaderboard={() => navigateTo(`/b/${encodeURIComponent(slug)}/leaderboard`)}
        onResetGame={resetGame}
        onStudentFormChange={updateStudentForm}
        onSubmitScore={handleSubmitScore}
      />
      {shouldShowIdentityModal && (
        <StudentIdentityModal
          open={shouldShowIdentityModal}
          errorMessage={identityError}
          form={studentForm}
          rememberStudent={rememberStudent}
          onConfirm={confirmStudentIdentity}
          onFormChange={updateStudentForm}
          onRememberChange={setRememberStudent}
        />
      )}
    </>
  );
}

// 导出 readRoute 供 App 使用
export { readRoute };
