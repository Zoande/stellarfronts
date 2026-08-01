import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiRequestError,
  createNewsComment,
  createNewsPost,
  deleteNewsPost,
  getAdminNewsPost,
  getAdminNewsPosts,
  getCurrentSession,
  getNewsPost,
  getNewsPosts,
  listNewsMedia,
  updateNewsPost,
  uploadNewsImage,
  voteNewsComment,
} from '@/auth/client';
import { UserErrorPage } from '@/components/UserErrorPage';
import type { UserErrorKind } from '@/components/UserErrorPage';
import type {
  AuthAccount,
  NewsComment,
  NewsCommentVote,
  NewsContentBlock,
  NewsMediaFile,
  NewsPost,
  NewsPostListItem,
  NewsPostMutationPayload,
  NewsPostStatus,
} from '@/auth/types';
import '../styles/News.css';

const inertNavItems = ['Forums', 'Support'];

function makeBlockId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'Draft';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function getRouteSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/news\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function defaultPostTitle(): string {
  return `News Post — ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}`;
}

function emptyPostPayload(): NewsPostMutationPayload {
  return {
    title: defaultPostTitle(),
    summary: '',
    coverImageUrl: null,
    blocks: [
      {
        id: makeBlockId(),
        type: 'paragraph',
        text: '',
      },
    ],
    status: 'draft',
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

function replaceComment(comments: NewsComment[], replacement: NewsComment): NewsComment[] {
  return comments.map((comment) => (comment.id === replacement.id ? replacement : comment));
}

function NewsTopNav() {
  return (
    <nav className="news-top-nav" aria-label="Community navigation">
      <a className="news-top-link" href="/">Home</a>
      <a className="news-top-link is-active" href="/news">News</a>
      {inertNavItems.map((item) => (
        <button className="news-top-link" type="button" key={item} aria-disabled="true">
          {item}
        </button>
      ))}
      <a className="news-top-link" href="https://www.elitedevs.org/contact.html" target="_blank" rel="noopener noreferrer">Contact</a>
    </nav>
  );
}

function MediaLibraryPicker({ files, onPick, onClose }: {
  files: NewsMediaFile[];
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="news-media-picker" role="dialog" aria-label="Media library">
      <div className="news-media-picker__header">
        <strong>Media Library</strong>
        <button type="button" className="news-icon-button" onClick={onClose} aria-label="Close">×</button>
      </div>
      {files.length === 0 ? (
        <p className="news-empty" style={{ margin: 12 }}>No images in library yet. Upload one above to add it.</p>
      ) : (
        <div className="news-media-picker__grid">
          {files.map((file) => (
            <button key={file.name} type="button" className="news-media-picker__item" onClick={() => onPick(file.url)}>
              <img src={file.url} alt={file.name} loading="lazy" />
              <span>{file.name.replace(/^seed-/, '')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewsBlockView({ block }: { block: NewsContentBlock }) {
  if (block.type === 'heading') {
    return <h2 className="news-article-subtitle">{block.text}</h2>;
  }
  if (block.type === 'paragraph') {
    return (
      <div className="news-article-copy">
        {block.text.split(/\n{2,}/).map((paragraph, index) => (
          paragraph.trim()
            ? <p key={`${block.id}-${index}`}>{paragraph}</p>
            : null
        ))}
      </div>
    );
  }
  return (
    <figure className="news-figure">
      <img src={block.imageUrl} alt={block.altText} loading="lazy" />
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  );
}

interface NewsEditorProps {
  post: NewsPost;
  busy: boolean;
  error: string;
  onClose: () => void;
  onDelete: (post: NewsPost) => void;
  onSave: (post: NewsPost, payload: NewsPostMutationPayload) => Promise<NewsPost | null>;
}

function NewsEditor({ post, busy, error, onClose, onDelete, onSave }: NewsEditorProps) {
  const [title, setTitle] = useState(post.title);
  const [summary, setSummary] = useState(post.summary);
  const [coverImageUrl, setCoverImageUrl] = useState(post.coverImageUrl ?? '');
  const [blocks, setBlocks] = useState<NewsContentBlock[]>(post.blocks);
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [mediaLibrary, setMediaLibrary] = useState<NewsMediaFile[] | null>(null);
  const [mediaPickTarget, setMediaPickTarget] = useState<'cover' | string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(post.title);
    setSummary(post.summary);
    setCoverImageUrl(post.coverImageUrl ?? '');
    setBlocks(post.blocks.length ? post.blocks : emptyPostPayload().blocks);
    setTimeout(() => titleRef.current?.select(), 50);
  }, [post.id]);

  const openMediaPicker = async (target: 'cover' | string) => {
    setMediaPickTarget(target);
    if (mediaLibrary !== null) return;
    setMediaLoading(true);
    try {
      setMediaLibrary(await listNewsMedia());
    } catch {
      setMediaLibrary([]);
    } finally {
      setMediaLoading(false);
    }
  };

  const handleMediaPick = (url: string) => {
    if (mediaPickTarget === 'cover') {
      setCoverImageUrl(url);
    } else if (mediaPickTarget) {
      updateBlock(mediaPickTarget, { imageUrl: url } as Partial<NewsContentBlock>);
    }
    setMediaPickTarget(null);
  };

  const payload = (status: NewsPostStatus): NewsPostMutationPayload => ({
    title,
    summary,
    coverImageUrl: coverImageUrl.trim() || null,
    blocks,
    status,
  });

  const updateBlock = (blockId: string, next: Partial<NewsContentBlock>) => {
    setBlocks((current) => current.map((block) => (
      block.id === blockId ? { ...block, ...next } as NewsContentBlock : block
    )));
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === blockId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [block] = next.splice(index, 1);
      next.splice(nextIndex, 0, block);
      return next;
    });
  };

  const addBlock = (type: NewsContentBlock['type']) => {
    const id = makeBlockId();
    const block: NewsContentBlock = type === 'image'
      ? { id, type: 'image', imageUrl: '', altText: '', caption: '' }
      : type === 'heading'
        ? { id, type: 'heading', text: '' }
        : { id, type: 'paragraph', text: '' };
    setBlocks((current) => [...current, block]);
  };

  const removeBlock = (blockId: string) => {
    setBlocks((current) => current.filter((block) => block.id !== blockId));
  };

  const uploadForBlock = async (blockId: string, file: File | undefined) => {
    if (!file) return;
    try {
      setUploadingBlockId(blockId);
      const dataUrl = await readFileAsDataUrl(file);
      const url = await uploadNewsImage(file.name, file.type, dataUrl);
      updateBlock(blockId, { imageUrl: url } as Partial<NewsContentBlock>);
    } finally {
      setUploadingBlockId(null);
    }
  };

  const uploadCover = async (file: File | undefined) => {
    if (!file) return;
    try {
      setCoverUploading(true);
      const dataUrl = await readFileAsDataUrl(file);
      setCoverImageUrl(await uploadNewsImage(file.name, file.type, dataUrl));
    } finally {
      setCoverUploading(false);
    }
  };

  return (
    <section className="news-editor" aria-label="News post editor">
      <div className="news-editor-heading">
        <div>
          <span className="news-kicker">Admin Editor</span>
          <h2>{post.status === 'published' ? 'Edit Published Post' : 'Edit Draft'}</h2>
        </div>
        <button type="button" className="news-icon-button" onClick={onClose} aria-label="Close editor">x</button>
      </div>

      <div className="news-editor-grid">
        <label>
          Title
          <input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Post title" />
        </label>
        <label>
          Summary
          <textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Short description shown on the index page" />
        </label>
        <label>
          Cover image URL
          <input value={coverImageUrl} onChange={(event) => setCoverImageUrl(event.target.value)} placeholder="https://…" />
        </label>
        <div className="news-cover-image-tools">
          <label className="news-upload-label">
            Upload cover
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => void uploadCover(event.target.files?.[0])}
            />
            <span>{coverUploading ? 'Uploading…' : 'Choose file'}</span>
          </label>
          <button type="button" className="news-secondary-button news-library-btn" onClick={() => void openMediaPicker('cover')} disabled={mediaLoading}>
            {mediaLoading && mediaPickTarget === 'cover' ? 'Loading…' : 'Browse Library'}
          </button>
        </div>
        {coverImageUrl && <img className="news-editor-preview" src={coverImageUrl} alt="Cover preview" />}
      </div>

      {mediaPickTarget !== null && mediaLibrary !== null && (
        <MediaLibraryPicker
          files={mediaLibrary}
          onPick={handleMediaPick}
          onClose={() => setMediaPickTarget(null)}
        />
      )}

      <div className="news-block-toolbar" aria-label="Add content blocks">
        <button type="button" onClick={() => addBlock('heading')}>Add Heading</button>
        <button type="button" onClick={() => addBlock('paragraph')}>Add Text</button>
        <button type="button" onClick={() => addBlock('image')}>Add Image</button>
      </div>

      <div className="news-editor-blocks">
        {blocks.map((block, index) => (
          <article className="news-editor-block" key={block.id}>
            <div className="news-editor-block__bar">
              <strong>{block.type}</strong>
              <div>
                <button type="button" onClick={() => moveBlock(block.id, -1)} disabled={index === 0}>Up</button>
                <button type="button" onClick={() => moveBlock(block.id, 1)} disabled={index + 1 === blocks.length}>Down</button>
                <button type="button" onClick={() => removeBlock(block.id)}>Remove</button>
              </div>
            </div>

            {block.type === 'heading' && (
              <input
                value={block.text}
                onChange={(event) => updateBlock(block.id, { text: event.target.value } as Partial<NewsContentBlock>)}
                placeholder="Section heading"
              />
            )}

            {block.type === 'paragraph' && (
              <textarea
                rows={7}
                value={block.text}
                onChange={(event) => updateBlock(block.id, { text: event.target.value } as Partial<NewsContentBlock>)}
                placeholder="Write the announcement text here"
              />
            )}

            {block.type === 'image' && (
              <div className="news-image-editor">
                <input
                  value={block.imageUrl}
                  onChange={(event) => updateBlock(block.id, { imageUrl: event.target.value } as Partial<NewsContentBlock>)}
                  placeholder="Image URL"
                />
                <div className="news-cover-image-tools">
                  <label className="news-upload-label">
                    Upload image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => void uploadForBlock(block.id, event.target.files?.[0])}
                    />
                    <span>{uploadingBlockId === block.id ? 'Uploading…' : 'Choose file'}</span>
                  </label>
                  <button type="button" className="news-secondary-button news-library-btn" onClick={() => void openMediaPicker(block.id)} disabled={mediaLoading}>
                    Browse Library
                  </button>
                </div>
                <input
                  value={block.altText}
                  onChange={(event) => updateBlock(block.id, { altText: event.target.value } as Partial<NewsContentBlock>)}
                  placeholder="Alt text for screen readers and search"
                />
                <input
                  value={block.caption}
                  onChange={(event) => updateBlock(block.id, { caption: event.target.value } as Partial<NewsContentBlock>)}
                  placeholder="Optional caption"
                />
                {block.imageUrl && <img className="news-editor-preview" src={block.imageUrl} alt="" />}
              </div>
            )}
          </article>
        ))}
      </div>

      {error && <div className="news-error">{error}</div>}

      <div className="news-editor-actions">
        <button type="button" className="news-secondary-button" onClick={() => onDelete(post)} disabled={busy}>
          Delete
        </button>
        <button type="button" className="news-secondary-button" onClick={() => void onSave(post, payload('draft'))} disabled={busy}>
          Save Draft
        </button>
        <button type="button" className="news-primary-button" onClick={() => void onSave(post, payload('published'))} disabled={busy}>
          Publish
        </button>
      </div>
    </section>
  );
}

export default function NewsPage() {
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [posts, setPosts] = useState<NewsPostListItem[]>([]);
  const [adminPosts, setAdminPosts] = useState<NewsPostListItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => getRouteSlug());
  const [selectedPost, setSelectedPost] = useState<NewsPost | null>(null);
  const [editingPost, setEditingPost] = useState<NewsPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fatalError, setFatalError] = useState<UserErrorKind | null>(null);
  const [editorError, setEditorError] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState('');

  const isAdmin = account?.accountType === 'admin';
  const visiblePosts = useMemo(() => posts.filter((post) => post.status === 'published'), [posts]);

  const loadPosts = async () => {
    const publicPosts = await getNewsPosts();
    setPosts(publicPosts);
  };

  const loadAdminPosts = async () => {
    if (!isAdmin) {
      setAdminPosts([]);
      return;
    }
    setAdminPosts(await getAdminNewsPosts());
  };

  const loadSelectedPost = async (slug: string | null, adminMode = isAdmin) => {
    if (!slug) {
      setSelectedPost(null);
      return;
    }
    setLoading(true);
    try {
      setFatalError(null);
      setError('');
      const post = adminMode ? await getAdminNewsPost(slug) : await getNewsPost(slug);
      setSelectedPost(post);
    } catch (loadError) {
      setSelectedPost(null);
      setFatalError(loadError instanceof ApiRequestError && loadError.status === 404
        ? 'pageNotFound'
        : 'serviceUnavailable');
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async (slug = selectedSlug) => {
    await loadPosts();
    if (isAdmin) {
      await loadAdminPosts();
    }
    await loadSelectedPost(slug);
  };

  useEffect(() => {
    void getCurrentSession()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setSessionReady(true));
  }, []);

  useEffect(() => {
    const onPopState = () => setSelectedSlug(getRouteSlug());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setFatalError(null);
        setError('');
        await loadPosts();
        await loadSelectedPost(selectedSlug, account?.accountType === 'admin');
      } catch {
        setFatalError('serviceUnavailable');
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedSlug, account?.accountType]);

  useEffect(() => {
    if (!sessionReady || !isAdmin) return;
    void loadAdminPosts().catch((loadError) => {
      setEditorError(loadError instanceof Error ? loadError.message : 'Could not load admin posts');
    });
  }, [sessionReady, isAdmin]);

  const openPost = (slug: string) => {
    window.history.pushState({}, '', `/news/${encodeURIComponent(slug)}`);
    setSelectedSlug(slug);
    setLoginPrompt('');
  };

  const backToIndex = () => {
    window.history.pushState({}, '', '/news');
    setSelectedSlug(null);
    setSelectedPost(null);
    setLoginPrompt('');
  };

  const handleNewPost = async () => {
    try {
      setEditorBusy(true);
      setEditorError('');
      const post = await createNewsPost(emptyPostPayload());
      setEditingPost(post);
      window.history.pushState({}, '', `/news/${encodeURIComponent(post.slug)}`);
      setSelectedSlug(post.slug);
      await refreshAll(post.slug);
    } catch (createError) {
      setEditorError(createError instanceof Error ? createError.message : 'Could not create news post');
    } finally {
      setEditorBusy(false);
    }
  };

  const handleEditPost = async (post: NewsPostListItem) => {
    try {
      setEditorBusy(true);
      setEditorError('');
      const loaded = await getAdminNewsPost(post.slug);
      setEditingPost(loaded);
      openPost(loaded.slug);
    } catch (editError) {
      setEditorError(editError instanceof Error ? editError.message : 'Could not load editor');
    } finally {
      setEditorBusy(false);
    }
  };

  const handleSavePost = async (post: NewsPost, payload: NewsPostMutationPayload) => {
    try {
      setEditorBusy(true);
      setEditorError('');
      const saved = await updateNewsPost(post.id, payload);
      setEditingPost(saved);
      setSelectedPost(saved);
      await refreshAll(saved.slug);
      return saved;
    } catch (saveError) {
      setEditorError(saveError instanceof Error ? saveError.message : 'Could not save post');
      return null;
    } finally {
      setEditorBusy(false);
    }
  };

  const handleDeletePost = async (post: NewsPost) => {
    if (!window.confirm(`Delete "${post.title}"?`)) return;
    try {
      setEditorBusy(true);
      setEditorError('');
      await deleteNewsPost(post.id);
      setEditingPost(null);
      backToIndex();
      await refreshAll(null);
    } catch (deleteError) {
      setEditorError(deleteError instanceof Error ? deleteError.message : 'Could not delete post');
    } finally {
      setEditorBusy(false);
    }
  };

  const requestLogin = (action: string) => {
    setLoginPrompt(`Sign in or create an account to ${action}.`);
  };

  const handleCommentSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPost) return;
    if (!account) {
      requestLogin('comment');
      return;
    }
    try {
      setCommentBusy(true);
      setError('');
      const comment = await createNewsComment(selectedPost.slug, commentBody);
      setSelectedPost({ ...selectedPost, comments: [...selectedPost.comments, comment] });
      setCommentBody('');
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : 'Could not post comment');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleVote = async (comment: NewsComment, vote: NewsCommentVote) => {
    if (!account) {
      requestLogin('vote');
      return;
    }
    if (!selectedPost) return;
    const nextVote: NewsCommentVote = comment.userVote === vote ? 0 : vote;
    try {
      const updated = await voteNewsComment(comment.id, nextVote);
      setSelectedPost({
        ...selectedPost,
        comments: replaceComment(selectedPost.comments, updated),
      });
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : 'Could not update vote');
    }
  };

  if (fatalError) {
    return (
      <UserErrorPage
        kind={fatalError}
        primaryLabel={fatalError === 'pageNotFound' ? 'Back to News' : 'Try Again'}
        onPrimary={fatalError === 'pageNotFound'
          ? () => window.location.assign('/news')
          : () => window.location.reload()}
        secondaryLabel="Home"
        onSecondary={() => window.location.assign('/')}
      />
    );
  }

  return (
    <main className="news-page">
      <div className="news-scanlines" aria-hidden="true" />
      <div className="news-shell">
        <NewsTopNav />

        <header className="news-hero">
          <div className="news-hero__line" aria-hidden="true" />
          <span className="news-kicker">StellarFronts · Public Archive</span>
          <h1>News</h1>
          <p>Development logs, announcements, and public updates for the game.</p>
          <div className="news-hero-meta" aria-label="Archive stats">
            <span><strong>{visiblePosts.length}</strong> {visiblePosts.length === 1 ? 'Entry' : 'Entries'}</span>
            {visiblePosts[0]?.publishedAt && (
              <span>Last entry <strong>{formatDate(visiblePosts[0].publishedAt)}</strong></span>
            )}
            {account && <span>Signed in as <strong>{account.username}</strong></span>}
          </div>
        </header>

        <div className="news-layout">
          <aside className="news-sidebar" aria-label="Published news posts">
            <div className="news-panel-heading">
              <h2>Latest Posts</h2>
              <span>{visiblePosts.length} published</span>
            </div>

            {loading && !visiblePosts.length && <div className="news-empty">Loading news</div>}
            {!loading && !visiblePosts.length && <div className="news-empty">No published posts yet.</div>}

            <div className="news-post-list">
              {visiblePosts.map((post) => (
                <button
                  className={`news-list-card ${post.slug === selectedSlug ? 'is-active' : ''}`}
                  type="button"
                  key={post.id}
                  onClick={() => openPost(post.slug)}
                >
                  {post.coverImageUrl && <img src={post.coverImageUrl} alt="" loading="lazy" />}
                  <span>{formatDate(post.publishedAt)}</span>
                  <strong>{post.title}</strong>
                  <small>{post.commentCount} comments</small>
                </button>
              ))}
            </div>

            {isAdmin && (
              <section className="news-admin-panel">
                <div className="news-panel-heading">
                  <h2>Admin</h2>
                  <button type="button" onClick={handleNewPost} disabled={editorBusy}>New Post</button>
                </div>
                {editorError && <div className="news-error">{editorError}</div>}
                <div className="news-admin-list">
                  {adminPosts.map((post) => (
                    <button type="button" key={post.id} onClick={() => void handleEditPost(post)}>
                      <span>{post.status}</span>
                      <strong>{post.title}</strong>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>

          <section className="news-main-column">
            {!selectedSlug && (
              <section className="news-index">
                {visiblePosts.map((post) => (
                  <article className="news-index-card" key={post.id}>
                    <div className="news-index-card__banner">
                      {post.coverImageUrl && <img src={post.coverImageUrl} alt="" loading="lazy" />}
                      <span className="news-index-card__date">{formatDate(post.publishedAt)}</span>
                    </div>
                    <div className="news-index-card__body">
                      <h2>{post.title}</h2>
                      {post.summary && <p>{post.summary}</p>}
                      <button type="button" onClick={() => openPost(post.slug)}>Read Post →</button>
                    </div>
                  </article>
                ))}
              </section>
            )}

            {selectedSlug && loading && <div className="news-empty">Loading post</div>}
            {error && <div className="news-error">{error}</div>}

            {selectedPost && (
              <article className="news-article">
                <button type="button" className="news-back-button" onClick={backToIndex}>← Back to News</button>

                {selectedPost.coverImageUrl ? (
                  <div className="news-article-banner">
                    <img src={selectedPost.coverImageUrl} alt="" loading="eager" />
                    <div className="news-article-banner__overlay">
                      <span className="news-kicker">
                        {formatDate(selectedPost.publishedAt)} · {selectedPost.author.username}
                        {selectedPost.status === 'draft' ? ' · Draft' : ''}
                      </span>
                      <h1>{selectedPost.title}</h1>
                      {selectedPost.summary && <p className="news-summary">{selectedPost.summary}</p>}
                    </div>
                  </div>
                ) : (
                  <div className="news-article-header">
                    <span className="news-kicker">
                      {formatDate(selectedPost.publishedAt)} · {selectedPost.author.username}
                      {selectedPost.status === 'draft' ? ' · Draft' : ''}
                    </span>
                    <h1>{selectedPost.title}</h1>
                    {selectedPost.summary && <p className="news-summary">{selectedPost.summary}</p>}
                  </div>
                )}

                <div className="news-content-blocks">
                  {selectedPost.blocks.map((block) => <NewsBlockView block={block} key={block.id} />)}
                </div>
              </article>
            )}

            {selectedPost && (
              <section className="news-comments" aria-label="Comments">
                <div className="news-panel-heading">
                  <h2>Comments</h2>
                  <span>{selectedPost.comments.length} visible</span>
                </div>

                <form className="news-comment-form" onSubmit={handleCommentSubmit}>
                  <textarea
                    rows={4}
                    value={commentBody}
                    readOnly={!account}
                    onClick={() => {
                      if (!account) requestLogin('comment');
                    }}
                    onChange={(event) => setCommentBody(event.target.value)}
                    placeholder={account ? 'Write a comment' : 'Sign in to comment'}
                  />
                  <button type="submit" className="news-primary-button" disabled={commentBusy}>
                    Post Comment
                  </button>
                </form>

                {loginPrompt && (
                  <div className="news-login-prompt">
                    <span>{loginPrompt}</span>
                    <a href="/">Login</a>
                  </div>
                )}

                <div className="news-comment-list">
                  {selectedPost.comments.map((comment) => (
                    <article className="news-comment" key={comment.id}>
                      <div className="news-comment-votes">
                        <button
                          type="button"
                          className={comment.userVote === 1 ? 'is-active' : ''}
                          onClick={() => void handleVote(comment, 1)}
                          aria-label="Upvote comment"
                        >
                          Up
                        </button>
                        <strong>{comment.score}</strong>
                        <button
                          type="button"
                          className={comment.userVote === -1 ? 'is-active' : ''}
                          onClick={() => void handleVote(comment, -1)}
                          aria-label="Downvote comment"
                        >
                          Down
                        </button>
                      </div>
                      <div>
                        <header>
                          <strong>{comment.author.username}</strong>
                          <span>{formatDate(comment.createdAt)}</span>
                        </header>
                        <p>{comment.body}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </section>
        </div>

        {editingPost && (
          <div className="news-editor-dock">
            <NewsEditor
              post={editingPost}
              busy={editorBusy}
              error={editorError}
              onClose={() => setEditingPost(null)}
              onDelete={handleDeletePost}
              onSave={handleSavePost}
            />
          </div>
        )}
      </div>

      <footer className="auth-legal-footer" aria-label="Legal">
        <button type="button" aria-disabled="true">Privacy Policy</button>
        <span aria-hidden="true">·</span>
        <button type="button" aria-disabled="true">Terms and Conditions</button>
      </footer>
    </main>
  );
}
