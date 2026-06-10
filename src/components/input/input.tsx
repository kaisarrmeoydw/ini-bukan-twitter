import Link from 'next/link';
import {
  useState,
  useEffect,
  useRef,
  useId,
  useMemo,
  useCallback
} from 'react';
import { Dialog } from '@headlessui/react';
import { AnimatePresence, motion } from 'framer-motion';
import cn from 'clsx';
import { toast } from 'react-hot-toast';
import { RichText } from '@atproto/api';
import { tweetsCollection, usersCollection } from '@lib/atproto/collections';
import { addDoc, doc, getDoc, serverTimestamp } from '@lib/atproto/store';
import {
  canonicalizeBskyPostLinksInText,
  getBskyPostLinkFromText,
  getTweetPath,
  getUserPath,
  removeBskyPostLinkFromText
} from '@lib/routes';
import {
  manageReply,
  uploadImages,
  manageTotalTweets,
  manageTotalPhotos
} from '@lib/atproto/utils';
import { useAuth } from '@lib/context/auth-context';
import {
  getHashtagSearchQuery,
  normalizeMention,
  type ActiveHashtag,
  type ActiveMention
} from '@lib/hashtags';
import { sleep } from '@lib/utils';
import { getImagesData } from '@lib/validation';
import {
  deleteTweetDraft,
  getTweetDraft,
  getTweetDraftId,
  getTweetDraftsForUser,
  saveTweetDraft,
  tweetDraftsChangedEvent,
  type LocalTweetDraft,
  type TweetDraftScope
} from '@lib/tweet-drafts';
import { createYouTubeCardFromText } from '@lib/youtube';
import { UserAvatar } from '@components/user/user-avatar';
import { TweetEmbed } from '@components/tweet/tweet-embed';
import { Modal } from '@components/modal/modal';
import { Button } from '@components/ui/button';
import { HeroIcon } from '@components/ui/hero-icon';
import { InputForm, fromTop } from './input-form';
import { ImagePreview } from './image-preview';
import { InputOptions } from './input-options';
import type { GifSelection } from './twitter-compose-picker';
import type { ReactNode, FormEvent, ChangeEvent, ClipboardEvent } from 'react';
import type { WithFieldValue } from '@lib/atproto/store';
import type { Variants } from 'framer-motion';
import type { User } from '@lib/types/user';
import type {
  EmbeddedTweet,
  Tweet,
  TweetCard,
  TweetReplySetting,
  TweetWithUser
} from '@lib/types/tweet';
import type { FilesWithId, ImagesPreview } from '@lib/types/file';

type InputProps = {
  modal?: boolean;
  reply?: boolean;
  compactReply?: boolean;
  focusSignal?: number;
  parent?: { id: string; username: string };
  disabled?: boolean;
  children?: ReactNode;
  quoteTweet?: TweetWithUser;
  replyModal?: boolean;
  closeModal?: () => void;
  onTweetSent?: (tweet: TweetWithUser) => void;
};

type TweetDraft = Omit<Tweet, 'id'> & {
  quoteTarget?: { id: string; createdBy: string };
  replySetting?: TweetReplySetting;
};

function getQuotedTweetPreview(tweet: TweetWithUser): EmbeddedTweet {
  return {
    id: tweet.id,
    authorName: tweet.user.name,
    authorUsername: tweet.user.username,
    authorAvatar: tweet.user.photoURL,
    authorVerified: tweet.user.verified,
    text: tweet.text,
    langs: tweet.langs,
    createdAt: tweet.createdAt,
    images: tweet.images,
    mediaWarning: tweet.mediaWarning,
    card: tweet.card
  };
}

export const variants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 }
};

const BLUESKY_POST_GRAPHEME_LIMIT = 300;

function getErrorMessage(error: unknown): string | null {
  return error instanceof Error && error.message ? error.message : null;
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.mp4$/i.test(file.name);
}

function isRemoteMediaUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function revokePreviewUrl(src: string): void {
  if (!isRemoteMediaUrl(src)) URL.revokeObjectURL(src);
}

function revokeImagePreviews(previews: ImagesPreview): void {
  previews.forEach(({ src }) => revokePreviewUrl(src));
}

function getTenorGifUri({
  src,
  aspectRatio
}: Pick<GifSelection, 'src' | 'aspectRatio'>): string {
  try {
    const url = new URL(src);

    if (aspectRatio?.width && aspectRatio?.height) {
      url.searchParams.set('ww', String(aspectRatio.width));
      url.searchParams.set('hh', String(aspectRatio.height));
    }

    return url.toString();
  } catch {
    return src;
  }
}

function getCardDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function createTenorGifCard(gif: GifSelection): TweetCard {
  const url = getTenorGifUri(gif);

  return {
    type: 'external',
    url,
    title: gif.title || 'GIF',
    description: `ALT: ${gif.title || 'GIF'}`,
    image: gif.preview || null,
    domain: getCardDomain(url)
  };
}

function formatDraftTime(updatedAt: number): string {
  return new Intl.DateTimeFormat('en-gb', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(updatedAt));
}

function getDraftContextLabel({
  type,
  parentUsername
}: LocalTweetDraft): string {
  if (type === 'reply') return `Reply to @${parentUsername ?? 'user'}`;
  if (type === 'quote') return 'Quote Tweet';

  return 'Tweet';
}

function getDraftPreviewText({ text, gifCard }: LocalTweetDraft): string {
  const trimmedText = text.trim();

  if (trimmedText) return trimmedText;
  if (gifCard) return gifCard.title || 'GIF';

  return 'Draft';
}

function TweetDraftsModal({
  open,
  drafts,
  currentDraftId,
  closeModal,
  selectDraft,
  deleteDraft
}: {
  open: boolean;
  drafts: LocalTweetDraft[];
  currentDraftId: string | null;
  closeModal: () => void;
  selectDraft: (draft: LocalTweetDraft) => void;
  deleteDraft: (draftId: string) => void;
}): JSX.Element {
  return (
    <Modal
      modalClassName='w-full max-w-xl overflow-hidden rounded-2xl bg-main-background text-light-primary shadow-xl dark:text-dark-primary'
      open={open}
      closeModal={closeModal}
    >
      <div
        className='grid h-[53px] grid-cols-[48px,1fr,48px] items-center border-b
                   border-light-border px-1 dark:border-dark-border'
      >
        <Button
          className='dark-bg-tab group relative h-9 w-9 rounded-full p-0
                     hover:bg-light-primary/10 active:bg-light-primary/20
                     dark:hover:bg-dark-primary/10 dark:active:bg-dark-primary/20'
          aria-label='Close'
          onClick={closeModal}
        >
          <HeroIcon className='h-5 w-5' iconName='XMarkIcon' />
        </Button>
        <Dialog.Title className='text-center text-xl font-extrabold'>
          Unsent Tweets
        </Dialog.Title>
        <span aria-hidden='true' />
      </div>
      <div className='max-h-[70vh] overflow-y-auto'>
        {drafts.length ? (
          drafts.map((draft) => {
            const selected = draft.id === currentDraftId;

            return (
              <div
                className='flex border-b border-light-border last:border-b-0 dark:border-dark-border'
                key={draft.id}
              >
                <button
                  className={cn(
                    `accent-bg-tab flex min-w-0 flex-1 flex-col gap-1 px-4 py-3
                     text-left hover:bg-light-primary/5 active:bg-light-primary/10
                     dark:hover:bg-dark-primary/5 dark:active:bg-dark-primary/10`,
                    selected && 'bg-main-accent/10'
                  )}
                  type='button'
                  onClick={(): void => selectDraft(draft)}
                >
                  <div className='flex w-full min-w-0 items-center gap-2 text-[13px] text-light-secondary dark:text-dark-secondary'>
                    <span className='font-bold text-light-primary dark:text-dark-primary'>
                      {getDraftContextLabel(draft)}
                    </span>
                    <span aria-hidden='true'>&middot;</span>
                    <span>{formatDraftTime(draft.updatedAt)}</span>
                    {draft.gifCard && (
                      <>
                        <span aria-hidden='true'>&middot;</span>
                        <span className='inline-flex items-center gap-1'>
                          <HeroIcon className='h-4 w-4' iconName='GifIcon' />
                          GIF
                        </span>
                      </>
                    )}
                  </div>
                  <p className='max-h-12 overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-6'>
                    {getDraftPreviewText(draft)}
                  </p>
                </button>
                <Button
                  className='dark-bg-tab m-2 h-9 w-9 shrink-0 rounded-full p-0 text-light-secondary
                             hover:bg-accent-red/10 hover:text-accent-red
                             active:bg-accent-red/20 dark:text-dark-secondary'
                  aria-label='Delete draft'
                  title='Delete draft'
                  onClick={(): void => deleteDraft(draft.id)}
                >
                  <HeroIcon className='h-5 w-5' iconName='TrashIcon' />
                </Button>
              </div>
            );
          })
        ) : (
          <div className='px-8 py-14 text-center'>
            <p className='text-xl font-extrabold'>No unsent Tweets</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function Input({
  modal,
  reply,
  compactReply,
  focusSignal,
  parent,
  disabled,
  children,
  quoteTweet,
  replyModal,
  closeModal,
  onTweetSent
}: InputProps): JSX.Element {
  const [selectedImages, setSelectedImages] = useState<FilesWithId>([]);
  const [imagesPreview, setImagesPreview] = useState<ImagesPreview>([]);
  const [selectedGifCard, setSelectedGifCard] = useState<TweetCard | null>(
    null
  );
  const [linkedQuoteTweet, setLinkedQuoteTweet] =
    useState<TweetWithUser | null>(null);
  const [linkedQuoteTweetId, setLinkedQuoteTweetId] = useState<string | null>(
    null
  );
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [visited, setVisited] = useState(false);
  const [replySetting, setReplySetting] =
    useState<TweetReplySetting>('everyone');
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [availableDrafts, setAvailableDrafts] = useState<LocalTweetDraft[]>([]);
  const [hydratedDraftId, setHydratedDraftId] = useState<string | null>(null);

  const { user } = useAuth();
  const activeUser = user as User;
  const { id: userId, name, username, photoURL } = activeUser;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const quotedTweetId = quoteTweet?.id ?? null;
  const draftScope = useMemo<TweetDraftScope>(
    () => ({
      userId,
      type: quotedTweetId ? 'quote' : reply || replyModal ? 'reply' : 'tweet',
      parentId: parent?.id ?? null,
      parentUsername: parent?.username ?? null,
      quoteTweetId: quotedTweetId
    }),
    [parent?.id, parent?.username, quotedTweetId, reply, replyModal, userId]
  );
  const currentDraftId = useMemo(
    () => getTweetDraftId(draftScope),
    [draftScope]
  );
  const youtubeCard = useMemo(
    () => createYouTubeCardFromText(inputValue),
    [inputValue]
  );
  const detectedPostLink = useMemo(
    () => (quoteTweet ? null : getBskyPostLinkFromText(inputValue)),
    [inputValue, quoteTweet]
  );
  const linkedQuoteIsCurrent =
    !!linkedQuoteTweet && linkedQuoteTweetId === detectedPostLink?.tweetId;
  const activeQuoteTweet =
    quoteTweet ?? (linkedQuoteIsCurrent ? linkedQuoteTweet : null);
  const submittedText = useMemo(
    () =>
      linkedQuoteIsCurrent && detectedPostLink
        ? removeBskyPostLinkFromText(inputValue, detectedPostLink)
        : canonicalizeBskyPostLinksInText(inputValue),
    [detectedPostLink, inputValue, linkedQuoteIsCurrent]
  );

  const previewCount = imagesPreview.length;
  const isUploadingImages = !!previewCount;
  const activeExternalCard =
    selectedGifCard ?? (!isUploadingImages ? youtubeCard : null);

  const refreshAvailableDrafts = useCallback((): void => {
    setAvailableDrafts(getTweetDraftsForUser(userId, draftScope.type));
  }, [draftScope.type, userId]);

  useEffect(() => {
    setHydratedDraftId(null);

    const draft = getTweetDraft(draftScope);

    if (draft) {
      setInputValue(draft.text);
      setReplySetting(draft.replySetting ?? 'everyone');
      setSelectedGifCard(draft.gifCard);
      setImagesPreview(draft.gifPreview ? [draft.gifPreview] : []);
      setSelectedImages([]);
      setVisited(!!draft.text.trim() || !!draft.gifPreview);
    }

    setHydratedDraftId(getTweetDraftId(draftScope));
  }, [draftScope]);

  useEffect(() => {
    refreshAvailableDrafts();

    window.addEventListener(tweetDraftsChangedEvent, refreshAvailableDrafts);

    return () =>
      window.removeEventListener(
        tweetDraftsChangedEvent,
        refreshAvailableDrafts
      );
  }, [refreshAvailableDrafts]);

  useEffect(() => {
    if (hydratedDraftId !== currentDraftId) return;

    const gifPreview = selectedGifCard
      ? imagesPreview.find(({ type }) => type === 'gif') ?? null
      : null;

    saveTweetDraft(draftScope, {
      text: inputValue,
      replySetting,
      gifCard: selectedGifCard,
      gifPreview
    });
  }, [
    currentDraftId,
    draftScope,
    hydratedDraftId,
    imagesPreview,
    inputValue,
    replySetting,
    selectedGifCard
  ]);

  useEffect(
    () => {
      if (modal) inputRef.current?.focus();
      return cleanImage;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!focusSignal) return;

    setVisited(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [focusSignal]);

  useEffect(() => {
    if (quoteTweet || !detectedPostLink) {
      setLinkedQuoteTweet(null);
      setLinkedQuoteTweetId(null);
      return;
    }

    if (linkedQuoteTweetId === detectedPostLink.tweetId) return;

    let canceled = false;
    const tweetId = detectedPostLink.tweetId;

    setLinkedQuoteTweetId(tweetId);
    setLinkedQuoteTweet(null);

    void (async (): Promise<void> => {
      const tweetSnapshot = await getDoc(doc(tweetsCollection, tweetId));

      if (!tweetSnapshot.exists()) return;

      const tweet = tweetSnapshot.data();
      const userSnapshot = await getDoc(doc(usersCollection, tweet.createdBy));

      if (!userSnapshot.exists() || canceled) return;

      setLinkedQuoteTweet({
        ...tweet,
        user: userSnapshot.data()
      });
    })().catch(() => {
      if (!canceled) setLinkedQuoteTweet(null);
    });

    return () => {
      canceled = true;
    };
  }, [detectedPostLink, linkedQuoteTweetId, quoteTweet]);

  const clearCurrentDraft = useCallback((): void => {
    deleteTweetDraft(draftScope);
    refreshAvailableDrafts();
  }, [draftScope, refreshAvailableDrafts]);

  const sendTweet = async (): Promise<void> => {
    inputRef.current?.blur();

    setLoading(true);

    try {
      const isReplying = reply ?? replyModal;

      const quotedTweet = activeQuoteTweet
        ? getQuotedTweetPreview(activeQuoteTweet)
        : null;
      const uploadedImages = selectedGifCard
        ? imagesPreview
        : await uploadImages(userId, selectedImages, imagesPreview);

      const tweetData: WithFieldValue<TweetDraft> = {
        text: submittedText || null,
        langs: [],
        parent: isReplying && parent ? parent : null,
        images: uploadedImages,
        mediaWarning: null,
        card: activeExternalCard,
        quotedTweet,
        userLikes: [],
        createdBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: null,
        userReplies: 0,
        userRetweets: [],
        userQuotes: 0,
        bookmarkCount: 0,
        replySetting: isReplying ? undefined : replySetting,
        quoteTarget: activeQuoteTweet
          ? { id: activeQuoteTweet.id, createdBy: activeQuoteTweet.createdBy }
          : undefined
      };

      await sleep(500);

      const [tweetRef] = await Promise.all([
        addDoc(
          tweetsCollection,
          tweetData as WithFieldValue<Omit<Tweet, 'id'>>
        ),
        manageTotalTweets('increment', userId),
        tweetData.images && manageTotalPhotos('increment', userId),
        isReplying && manageReply('increment', parent?.id as string)
      ]);

      const tweetSnapshot = await getDoc(tweetRef);
      const createdTweet = tweetSnapshot.data();
      const tweetId = tweetSnapshot.id;

      onTweetSent?.({
        ...createdTweet,
        id: tweetId,
        user: activeUser
      });

      clearCurrentDraft();

      if (!modal && !replyModal) discardTweet();

      if (closeModal) closeModal();

      toast.success(
        () => (
          <span className='flex gap-2'>
            Your Tweet was sent
            <Link href={getTweetPath(tweetId, username)}>
              <a className='custom-underline font-bold'>View</a>
            </Link>
          </span>
        ),
        { duration: 6000 }
      );
    } catch (error) {
      const message = getErrorMessage(error);
      toast.error(
        message
          ? `Tweet could not be sent: ${message}`
          : 'Tweet could not be sent'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (
    e: ChangeEvent<HTMLInputElement> | ClipboardEvent<HTMLTextAreaElement>
  ): void => {
    const isClipboardEvent = 'clipboardData' in e;

    if (isClipboardEvent) {
      const isPastingText = e.clipboardData.getData('text');
      if (isPastingText) return;
    }

    const files = isClipboardEvent ? e.clipboardData.files : e.target.files;

    if (selectedGifCard) {
      toast.error('Remove the GIF before adding photos or video.');
      return;
    }

    const imagesData = getImagesData(files, {
      currentFiles: previewCount,
      allowUploadingVideos: true
    });

    if (!imagesData) {
      toast.error(
        'Please choose up to 4 JPG, PNG, or WebP images, or one MP4 video.'
      );
      return;
    }

    const { imagesPreviewData, selectedImagesData } = imagesData;
    const hasCurrentVideo = selectedImages.some(isVideoFile);
    const hasNewVideo = selectedImagesData.some(isVideoFile);

    if (
      (hasCurrentVideo && selectedImagesData.length) ||
      (hasNewVideo &&
        (selectedImages.length > 0 || selectedImagesData.length > 1))
    ) {
      revokeImagePreviews(imagesPreviewData);
      toast.error('Bluesky allows either one video or up to 4 images.');
      return;
    }

    setImagesPreview([...imagesPreview, ...imagesPreviewData]);
    setSelectedImages([...selectedImages, ...selectedImagesData]);

    inputRef.current?.focus();
  };

  const removeImage = (targetId: string) => (): void => {
    const removedPreview = imagesPreview.find(({ id }) => id === targetId);

    setSelectedImages(selectedImages.filter(({ id }) => id !== targetId));
    setImagesPreview(imagesPreview.filter(({ id }) => id !== targetId));
    if (removedPreview?.type === 'gif') setSelectedGifCard(null);

    if (removedPreview) revokePreviewUrl(removedPreview.src);
  };

  const updateImageAltText = (targetId: string, altText: string): void => {
    const normalizedAltText = altText.trim();

    setImagesPreview((currentPreviews) =>
      currentPreviews.map((preview) =>
        preview.id === targetId
          ? { ...preview, altText: normalizedAltText || null }
          : preview
      )
    );
  };

  const cleanImage = (): void => {
    revokeImagePreviews(imagesPreview);

    setSelectedImages([]);
    setImagesPreview([]);
    setSelectedGifCard(null);
  };

  const resetComposer = (): void => {
    setInputValue('');
    setVisited(false);
    setReplySetting('everyone');
    cleanImage();
  };

  const discardTweet = (): void => {
    clearCurrentDraft();
    resetComposer();
    inputRef.current?.blur();
  };

  const openDraftsModal = (): void => {
    refreshAvailableDrafts();
    setDraftsOpen(true);
  };

  const closeDraftsModal = (): void => setDraftsOpen(false);

  const selectDraft = (draft: LocalTweetDraft): void => {
    setInputValue(draft.text);
    setReplySetting(draft.replySetting ?? 'everyone');
    setSelectedGifCard(draft.gifCard);
    setImagesPreview(draft.gifPreview ? [draft.gifPreview] : []);
    setSelectedImages([]);
    setVisited(!!draft.text.trim() || !!draft.gifPreview);
    setDraftsOpen(false);

    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const deleteDraft = (draftId: string): void => {
    deleteTweetDraft(draftId);
    refreshAvailableDrafts();

    if (draftId === currentDraftId) resetComposer();
  };

  const handleChange = ({
    target: { value }
  }: ChangeEvent<HTMLTextAreaElement>): void => setInputValue(value);

  const handleEmojiSelect = (emoji: string): void => {
    const input = inputRef.current;
    const selectionStart = input?.selectionStart ?? inputValue.length;
    const selectionEnd = input?.selectionEnd ?? inputValue.length;
    const nextValue = `${inputValue.slice(
      0,
      selectionStart
    )}${emoji}${inputValue.slice(selectionEnd)}`;
    const nextCursorPosition = selectionStart + emoji.length;

    setInputValue(nextValue);

    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const handleHashtagSelect = (
    tag: string,
    { start, end }: ActiveHashtag
  ): void => {
    const input = inputRef.current;
    const hashtag = getHashtagSearchQuery(tag);
    const suffix = inputValue[end] && !/\s/.test(inputValue[end]) ? ' ' : '';
    const nextValue = `${inputValue.slice(
      0,
      start
    )}${hashtag}${suffix}${inputValue.slice(end)}`;
    const nextCursorPosition = start + hashtag.length + suffix.length;

    setInputValue(nextValue);

    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const handleMentionSelect = (
    username: string,
    { start, end }: ActiveMention
  ): void => {
    const input = inputRef.current;
    const mention = `@${normalizeMention(username)}`;
    const suffix = inputValue[end] && /\s/.test(inputValue[end]) ? '' : ' ';
    const nextValue = `${inputValue.slice(
      0,
      start
    )}${mention}${suffix}${inputValue.slice(end)}`;
    const nextCursorPosition = start + mention.length + suffix.length;

    setInputValue(nextValue);

    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const handleGifSelect = ({
    id,
    title,
    src,
    preview,
    aspectRatio
  }: GifSelection): void => {
    if (previewCount || selectedImages.length) {
      toast.error('GIFs cannot be mixed with photos or videos on Bluesky.');
      return;
    }

    const gifPreview = {
      id: `tenor-${id}`,
      src,
      alt: title,
      type: 'gif',
      poster: preview,
      aspectRatio
    };

    setSelectedGifCard(
      createTenorGifCard({ id, title, src, preview, aspectRatio })
    );
    setImagesPreview([gifPreview]);
    setSelectedImages([]);

    inputRef.current?.focus();
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!isValidTweet || loading) return;
    void sendTweet();
  };

  const handleFocus = (): void => setVisited(!loading);

  const formId = useId();

  const inputLimit = BLUESKY_POST_GRAPHEME_LIMIT;
  const quotedTweetPreview = activeQuoteTweet
    ? getQuotedTweetPreview(activeQuoteTweet)
    : null;
  const shouldCompactQuotedTweetPreview =
    isUploadingImages || !!activeExternalCard;
  const showModalHeader = !!modal && !replyModal && !!closeModal;

  const inputLength = useMemo(
    () =>
      new RichText({ text: submittedText }, { cleanNewlines: true })
        .graphemeLength,
    [submittedText]
  );
  const isValidInput = !!submittedText.length;
  const isCharLimitExceeded = inputLength > inputLimit;

  const isValidTweet =
    !isCharLimitExceeded &&
    (isValidInput || isUploadingImages || !!activeQuoteTweet);

  return (
    <form
      className={cn('flex flex-col', {
        '-mx-4': reply,
        'gap-2': replyModal,
        'cursor-not-allowed': disabled
      })}
      onSubmit={handleSubmit}
    >
      <TweetDraftsModal
        open={draftsOpen}
        drafts={availableDrafts}
        currentDraftId={currentDraftId}
        closeModal={closeDraftsModal}
        selectDraft={selectDraft}
        deleteDraft={deleteDraft}
      />
      {loading && (
        <motion.i className='h-1 animate-pulse bg-main-accent' {...variants} />
      )}
      {showModalHeader && (
        <header
          className='flex h-[53px] shrink-0 items-center justify-between border-b
                     border-light-border px-2 dark:border-dark-border'
        >
          <Button
            className='dark-bg-tab group relative h-9 w-9 rounded-full p-0
                       hover:bg-light-primary/10 active:bg-light-primary/20
                       dark:hover:bg-dark-primary/10 dark:active:bg-dark-primary/20'
            aria-label='Close'
            onClick={closeModal}
          >
            <HeroIcon className='h-5 w-5' iconName='XMarkIcon' />
          </Button>
          {!quoteTweet && (
            <Button
              className='accent-tab accent-bg-tab px-4 py-2 text-[15px] font-bold
                         leading-5 text-main-accent hover:bg-main-accent/10
                         active:bg-main-accent/20'
              onClick={openDraftsModal}
            >
              Unsent Tweets
            </Button>
          )}
        </header>
      )}
      {children}
      {reply && visited && (
        <motion.p
          className={cn(
            '-mb-2 mt-2 text-light-secondary dark:text-dark-secondary',
            compactReply ? 'ml-[68px]' : 'ml-[75px]'
          )}
          {...fromTop}
        >
          Replying to{' '}
          <Link href={getUserPath(parent?.username as string)}>
            <a className='custom-underline text-main-accent'>
              {parent?.username as string}
            </a>
          </Link>
        </motion.p>
      )}
      <label
        className={cn(
          'hover-animation grid w-full grid-cols-[auto,1fr] gap-3 px-4 py-3',
          reply
            ? 'pt-3 pb-1'
            : replyModal
            ? 'pt-0'
            : modal
            ? 'pb-4'
            : 'border-b border-light-border dark:border-dark-border',
          compactReply && 'pr-5',
          (disabled || loading) && 'pointer-events-none opacity-50'
        )}
        htmlFor={formId}
      >
        <UserAvatar
          size={compactReply ? 40 : undefined}
          src={photoURL}
          alt={name}
          username={username}
        />
        <div className='flex w-full min-w-0 flex-col gap-4'>
          <InputForm
            modal={modal}
            reply={reply}
            quote={!!activeQuoteTweet}
            formId={formId}
            visited={visited}
            loading={loading}
            inputRef={inputRef}
            replyModal={replyModal}
            inputValue={inputValue}
            replySetting={replySetting}
            isValidTweet={isValidTweet}
            isUploadingImages={isUploadingImages}
            setReplySetting={setReplySetting}
            sendTweet={sendTweet}
            handleHashtagSelect={handleHashtagSelect}
            handleMentionSelect={handleMentionSelect}
            handleFocus={handleFocus}
            discardTweet={discardTweet}
            handleChange={handleChange}
            handleImageUpload={handleImageUpload}
          >
            {isUploadingImages && (
              <ImagePreview
                imagesPreview={imagesPreview}
                previewCount={previewCount}
                removeImage={!loading ? removeImage : undefined}
                updateAltText={!loading ? updateImageAltText : undefined}
              />
            )}
            {youtubeCard && !selectedGifCard && !isUploadingImages && (
              <div className='min-w-0 max-w-full overflow-hidden'>
                <TweetEmbed card={youtubeCard} quotedTweet={null} />
              </div>
            )}
            {quotedTweetPreview && (
              <div className='min-w-0 max-w-full overflow-hidden'>
                <TweetEmbed
                  card={null}
                  quotedTweet={quotedTweetPreview}
                  hideQuotedTweetMedia={shouldCompactQuotedTweetPreview}
                  expandQuotedTweet={!shouldCompactQuotedTweetPreview}
                />
              </div>
            )}
          </InputForm>
          <AnimatePresence initial={false}>
            {(reply ? reply && visited && !loading : !loading) && (
              <InputOptions
                reply={reply}
                modal={modal}
                inputLimit={inputLimit}
                inputLength={inputLength}
                isValidTweet={isValidTweet}
                isCharLimitExceeded={isCharLimitExceeded}
                handleImageUpload={handleImageUpload}
                handleEmojiSelect={handleEmojiSelect}
                handleGifSelect={handleGifSelect}
              />
            )}
          </AnimatePresence>
        </div>
      </label>
    </form>
  );
}
