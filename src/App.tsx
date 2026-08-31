import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ZenEditor } from './components/ZenEditor';
import { ContentHub } from './components/ContentHub';
import { BrandManager } from './components/BrandManager';
import { NanoBananaStudioModal } from './components/NanoBananaStudioModal';
import { AutoBlogScheduler } from './components/AutoBlogScheduler';
import { SettingsTab } from './components/SettingsTab';
import { FeatureTracker } from './components/FeatureTracker';
import { LoginScreen } from './components/LoginScreen';
import { INITIAL_BRANDS, INITIAL_CONTENT } from './data/initialData';
import { Brand, ContentItem, PipelineStatus, AppUser, FeatureRequest } from './types';
import { initAuth, db, USE_EMULATORS, adminCreateAccount, usernameToEmail } from './lib/firebase';
import { User } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { BlogRegisterEntry, buildRegisterEntry, nextBlogNumber, collectUsedNumbers } from './lib/blogRegister';

/** Firestore rejects `undefined` field values, so strip them before writing. */
function sanitizeForFirestore<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map((v) => (v === undefined ? null : v)) as unknown as T;
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = sanitizeForFirestore(v);
    }
    return out as T;
  }
  return obj;
}

export default function App() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [features, setFeatures] = useState<FeatureRequest[]>([]);
  const [register, setRegister] = useState<BlogRegisterEntry[]>([]);

  const [selectedBrandId, setSelectedBrandId] = useState<string>('dtp-brand');
  const [activeTab, setActiveTab] = useState<string>('pipeline');
  const [activeItemId, setActiveItemId] = useState<string>('item-1');

  // Sidebar state: desktop collapse (persisted) + mobile drawer
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fgos_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('fgos_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // ignore storage errors (private mode etc.)
      }
      return next;
    });
  };

  const navigateTab = (tab: string) => {
    setActiveTab(tab);
    setMobileSidebarOpen(false);
  };

  useEffect(() => {
    if (brands.length > 0 && selectedBrandId !== 'all' && !brands.find(b => b.id === selectedBrandId)) {
      setSelectedBrandId(brands[0].id);
    }
  }, [brands, selectedBrandId]);

  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);

  // Read the user's app_users profile and decide approved / pending / legacy
  const checkApproval = async (u: User): Promise<AppUser | null> => {
    const ref = doc(db, 'app_users', u.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const profile = { id: u.uid, ...snap.data() } as AppUser;
      setAppUser(profile);
      return profile;
    }

    // New user with no profile — determine if this is the first user (owner)
    // or a subsequent user who needs admin approval.
    let isFirstUser = false;
    try {
      const bootstrapSnap = await getDoc(doc(db, 'app_meta', 'bootstrap'));
      isFirstUser = !bootstrapSnap.exists();
    } catch {
      isFirstUser = true; // If we can't check, provision as admin (safe for emulator)
    }

    const profile: AppUser = {
      id: u.uid,
      username: (u.email || 'user').split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') || 'user',
      role: isFirstUser ? 'admin' : 'member',
      approved: isFirstUser, // Only auto-approve the first user (owner)
      createdAt: new Date().toISOString(),
      userId: u.uid,
    };
    try {
      await setDoc(ref, profile as any);
      if (isFirstUser) {
        await setDoc(doc(db, 'app_meta', 'bootstrap'), {
          initialized: true,
          adminUid: u.uid,
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn('Could not provision the user profile:', err);
    }
    setAppUser(profile);
    return profile;
  };

  const handleAuthUser = async (authUser: User) => {
    setUser(authUser);
    setAuthError(null);
    setAuthResolved(true);
    const profile = await checkApproval(authUser);
    if (!profile || !profile.approved) {
      setAuthError('Your account is not approved. Ask an administrator to approve it in Settings → User Management.');
    }
  };

  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser) => { handleAuthUser(authUser); },
      () => {
        setAuthResolved(true);
        if (USE_EMULATORS) {
          setAuthError(
            'Automatic sign-in failed. Make sure the Firebase emulators are running (firestore :8080, auth :9099) and that the owner credentials in src/lib/firebase.ts match the seeded emulator.'
          );
        }
        // In production: no error — just let the login screen show
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // One-time check for new user seeding
    const checkAndSeed = async () => {
      const storageKey = `fgos_seeded_${user.uid}`;
      if (localStorage.getItem(storageKey)) return;

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists() || !userDoc.data().isSeeded) {
          // Mark as seeded first to avoid race conditions
          await setDoc(userDocRef, { isSeeded: true }, { merge: true });

          // Brand/content docs are scoped to the user (prefix the seed id with
          // the uid) so every account gets its own workspace copy — global ids
          // would collide: a second user's seed would be a denied update of the
          // first user's brand (ownership rules).
          const scope = (id: string) => `${user.uid}_${id}`;
          const scopedBrandIds = new Map<string, string>();

          for (const brand of INITIAL_BRANDS) {
            const brandId = scope(brand.id);
            scopedBrandIds.set(brand.id, brandId);
            await setDoc(doc(db, 'brands', brandId), { ...brand, id: brandId, userId: user.uid });
          }

          for (const item of INITIAL_CONTENT) {
            const itemId = scope(item.id);
            const brandId = scopedBrandIds.get(item.brandId) || scope(item.brandId);
            await setDoc(doc(db, 'content_items', itemId), { ...item, id: itemId, brandId, userId: user.uid });
          }

          // Seed feature requests from Carol's initial brief
          const initialFeatures = [
            {
              id: scope('feat-pub-dates'),
              title: 'Record original publication date & refresh date',
              description: 'Prevent rehashed content becoming duplicates. Track when a blog was first published and when it was last refreshed, plus count how many times it has been repurposed.',
              status: 'requested' as const, priority: 'high' as const, area: 'editor' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-21T10:35:00').toISOString(),
              tags: ['content-management', 'dates'], notes: '',
            },
            {
              id: scope('feat-brand-numbering'),
              title: 'Brand-specific blog numbering sequences',
              description: 'Each brand gets its own starting number: Home At Peace starts at 1000, Daniel\'s Tasty Petfoods at 2000, etc. Prevents cross-brand reference collisions.',
              status: 'requested' as const, priority: 'high' as const, area: 'autoblog' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-21T10:35:00').toISOString(),
              tags: ['autoblog', 'branding', 'numbering'], notes: '',
            },
            {
              id: scope('feat-quarterly-themes'),
              title: 'Quarterly theme-based blog generation',
              description: 'Phase 2: Give FGOS a theme (e.g. "Helping Children Fall in Love with Reading") and it searches the Information Bank for relevant material, creates multiple articles around subtopics, identifies older blogs that fit the theme for refreshing.',
              status: 'requested' as const, priority: 'medium' as const, area: 'autoblog' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-21T10:35:00').toISOString(),
              tags: ['phase-2', 'themes', 'information-bank'], notes: 'Also need a way to remind FGOS to draw on the Information Bank / IP.',
            },
            {
              id: scope('feat-internal-linking'),
              title: 'AI-powered contextual internal linking',
              description: 'For every new blog, identify relevant existing content and insert contextual internal links naturally within the article.',
              status: 'requested' as const, priority: 'critical' as const, area: 'seo' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-25T12:15:00').toISOString(),
              tags: ['seo', 'internal-linking', 'content-intelligence'], notes: 'Critical for SEO. Requires content register.',
            },
            {
              id: scope('feat-related-sections'),
              title: 'Dynamic Related Articles / Products / CTA sections',
              description: 'Templates contain designated sections for Related Articles, Related Products/Services, and a dynamic final CTA. FGOS determines what is relevant and populates these sections per brand.',
              status: 'requested' as const, priority: 'high' as const, area: 'wordpress' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-25T12:15:00').toISOString(),
              tags: ['wordpress', 'templates', 'cta'], notes: 'FCC recommends books, DTP recommends products, HaP recommends care services.',
            },
            {
              id: scope('feat-content-register'),
              title: 'Content register / library awareness',
              description: 'Maintain a register of all published content: title, URL, brand, category/topic, keywords, publication date, related products. AI uses this for internal linking decisions.',
              status: 'requested' as const, priority: 'critical' as const, area: 'dashboard' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-25T12:15:00').toISOString(),
              tags: ['content-intelligence', 'wp-rest-api', 'seo'], notes: 'Either maintain in Firestore or pull live from WordPress REST API.',
            },
            {
              id: scope('feat-kadence-templates'),
              title: 'Kadence-compatible reusable blog templates',
              description: 'Long Blog and Short Blog templates built using Kadence global styles. No hard-coded brand fonts/colours — each site applies its own global styling automatically.',
              status: 'planned' as const, priority: 'high' as const, area: 'wordpress' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-25T11:39:00').toISOString(),
              tags: ['wordpress', 'kadence', 'templates'], notes: 'Sumbul building the templates. FGOS automation must target these reliably.',
            },
            {
              id: scope('feat-wp-mcp-capabilities'),
              title: 'WordPress MCP — full capability mapping',
              description: 'Document what the WP MCP exposes: create/update posts & pages, SEO titles/meta, headings, image alt text, product/CTA links, internal linking, Gutenberg/Kadence blocks, menus, CSS/template settings, routine maintenance.',
              status: 'planned' as const, priority: 'medium' as const, area: 'wordpress' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-20T11:28:00').toISOString(),
              tags: ['wordpress', 'mcp', 'integration'], notes: 'Carol wants to know if ChatGPT can also use the WP MCP for ongoing maintenance.',
            },
            {
              id: scope('feat-grammar-rules'),
              title: 'Grammar & style rules — no "And"/"But" sentence starts',
              description: 'Adjust content-generation instructions so sentences never begin with "And" or "But". Use British English, correct grammar and punctuation, natural sentence construction, avoid unnecessary repetition and obvious AI-style phrasing. Generated copy should require very little editorial correction.',
              status: 'requested' as const, priority: 'critical' as const, area: 'editor' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
              tags: ['writing-rules', 'grammar', 'british-english', 'quality'], notes: 'Found a sentence beginning with "And" in a produced blog. Must be fixed at source, not manually.',
            },
            {
              id: scope('feat-end-to-end-test'),
              title: 'End-to-end final test — generation to published blog',
              description: 'Final test must cover the complete process from content generation through to the finished WordPress blog, including all dynamic template fields.',
              status: 'requested' as const, priority: 'high' as const, area: 'deployment' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
              tags: ['testing', 'qa', 'deployment'], notes: 'Sumbul has completed the blog template. Need full pipeline verification.',
            },
            {
              id: scope('feat-auto-blog-numbering'),
              title: 'Automatic Blog Number generation & population',
              description: 'Automatically generate and populate the Blog Number field in WordPress. Format per brand: FGC-001, HAP-001, DTP-001, OC-001. System identifies the website/brand, assigns the next available number, and inserts it into the WordPress Blog Number field automatically.',
              status: 'requested' as const, priority: 'critical' as const, area: 'wordpress' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
              tags: ['blog-numbering', 'wordpress', 'automation'], notes: 'Sumbul created a dynamic Blog Number field in WordPress. Currently manual — needs automation.',
            },
            {
              id: scope('feat-blog-register-sync'),
              title: 'Blog Register sync — number matches records',
              description: 'The same reference number must be recorded automatically in the Blog Register/Blog History so the number shown on the published article always matches the number held in records. This becomes the permanent reference for tracking as the library grows.',
              status: 'requested' as const, priority: 'critical' as const, area: 'dashboard' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
              tags: ['blog-register', 'tracking', 'content-library'], notes: 'Permanent reference for each article. Must match published article exactly.',
            },
            {
              id: scope('feat-duplicate-number-prevention'),
              title: 'Duplicate Blog Number prevention',
              description: 'Check the existing Blog History before assigning a number so a reference can never accidentally be issued twice — even if a blog is deleted, rescheduled, or returned to draft.',
              status: 'requested' as const, priority: 'critical' as const, area: 'autoblog' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
              tags: ['blog-numbering', 'uniqueness', 'data-integrity'], notes: 'Must never issue the same number twice under any workflow state.',
            },
            {
              id: scope('feat-dynamic-fields-population'),
              title: 'Auto-populate dynamic template fields (CTA, Related Articles, Products)',
              description: 'Where the template contains dynamic fields such as the CTA, Related Articles and Related Products/Services, the automation must populate these wherever agreed, rather than creating unnecessary manual work.',
              status: 'requested' as const, priority: 'high' as const, area: 'wordpress' as const,
              requestedBy: 'Carol', requestedAt: new Date('2026-08-29T23:30:00').toISOString(),
              tags: ['wordpress', 'templates', 'dynamic-fields', 'automation'], notes: 'Sumbul created dynamic functionality for CTA, Related Articles, Related Products/Services.',
            },
          ];
          for (const feat of initialFeatures) {
            await setDoc(doc(db, 'feature_requests', feat.id), { ...feat, userId: user.uid });
          }

          // Pre-create Carol's email/password account so she can log in.
          // Her Firestore profile will be auto-provisioned when she signs in
          // for the first time (see checkApproval). The owner can then promote
          // her to admin via Settings → User Management.
          try {
            await adminCreateAccount('Carol', 'Process1949**');
            console.log('[Seed] Carol superadmin account created (carol@fgos.local)');
          } catch (err: any) {
            // Already exists — that's fine
            if (err?.code !== 'auth/email-already-in-use') {
              console.debug('Carol account creation skipped:', err?.message || err);
            }
          }
        }
        localStorage.setItem(storageKey, 'true');
      } catch (err) {
        // Silently handle offline or permission errors during initial seed check
        console.debug("Skipped seeding check due to network or permissions.");
      }
    };
    
    checkAndSeed();

    const qBrands = query(collection(db, 'brands'), where('userId', '==', user.uid));
    const unsubscribeBrands = onSnapshot(qBrands, (snapshot) => {
      const fbBrands = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand));
      setBrands(fbBrands);
    }, (error) => {
      console.error("Error fetching brands snapshot:", error);
    });

    const qItems = query(collection(db, 'content_items'), where('userId', '==', user.uid));
    const unsubscribeItems = onSnapshot(qItems, (snapshot) => {
      const fbItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ContentItem));
      setItems(fbItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }, (error) => {
      console.error("Error fetching items snapshot:", error);
    });

    const qFeatures = query(collection(db, 'feature_requests'), where('userId', '==', user.uid));
    const unsubscribeFeatures = onSnapshot(qFeatures, (snapshot) => {
      const fbFeatures = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FeatureRequest));
      setFeatures(fbFeatures);
    }, (error) => {
      console.error("Error fetching feature requests snapshot:", error);
    });

    const qRegister = query(collection(db, 'blog_register'), where('userId', '==', user.uid));
    const unsubscribeRegister = onSnapshot(qRegister, (snapshot) => {
      const fbRegister = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BlogRegisterEntry));
      setRegister(fbRegister);
    }, (error) => {
      console.error("Error fetching blog register snapshot:", error);
    });

    return () => {
      unsubscribeBrands();
      unsubscribeItems();
      unsubscribeFeatures();
      unsubscribeRegister();
    };
  }, [user]);

  // Brand Management Actions
  const handleSaveBrand = async (updatedBrand: Brand) => {
    if (!user) return;
    try {
      const brandToSave = { ...updatedBrand, userId: user.uid };
      await setDoc(doc(db, 'brands', updatedBrand.id), brandToSave);
    } catch (err) {
      console.error('Failed to save brand', err);
    }
  };

  const handleDeleteBrand = async (brandId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'brands', brandId));
    } catch (err) {
      console.error('Failed to delete brand', err);
    }
  };

  // Content Item Actions
  const handleSaveItem = async (updatedItem: ContentItem) => {
    if (!user) return;
    try {
      const itemToSave = { ...updatedItem, userId: user.uid };
      // Firestore rejects undefined field values ("invalid-argument"), and blocks
      // routinely contain them (imageLayout/author/cards/slides are only set for
      // their block type). Deep-strip undefined before persisting so autosaves
      // never die silently.
      const stripUndefined = (v: any): any => {
        if (Array.isArray(v)) return v.map(stripUndefined);
        if (v && typeof v === 'object') {
          const o: Record<string, any> = {};
          for (const [k, val] of Object.entries(v)) {
            if (val !== undefined) o[k] = stripUndefined(val);
          }
          return o;
        }
        return v;
      };
      await setDoc(doc(db, 'content_items', updatedItem.id), stripUndefined(itemToSave));
      // Keep the Blog Register in sync with the item (title, keywords, status,
      // dates, live link all flow through here).
      const brand = brands.find((b) => b.id === updatedItem.brandId);
      await setDoc(doc(db, 'blog_register', updatedItem.id), sanitizeForFirestore(buildRegisterEntry(updatedItem, brand, user.uid)));
    } catch (err) {
      console.error('Failed to save content item', err);
    }
  };

  // Deletes an item from Firestore and trashes its WordPress post (if any).
  const handleDeleteItem = async (item: ContentItem): Promise<{ success: boolean; message?: string }> => {
    if (!user) return { success: false, message: 'Not signed in.' };
    try {
      if (item.wpPostId) {
        const brand = brands.find((b) => b.id === item.brandId);
        if (!brand) return { success: false, message: 'Could not find the brand connection for this item.' };
        try {
          const res = await fetch('/api/wp/delete-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brand, wpPostId: item.wpPostId, contentType: item.contentType }),
          });
          const data = await res.json();
          if (!data.success) {
            return { success: false, message: `WordPress: ${data.message || 'could not trash the post.'}` };
          }
        } catch (err: any) {
          return { success: false, message: `Could not reach WordPress: ${err.message}` };
        }
      }
      await deleteDoc(doc(db, 'content_items', item.id));
      // Remove the matching Blog Register entry too.
      try { await deleteDoc(doc(db, 'blog_register', item.id)); } catch { /* best-effort */ }
      return { success: true };
    } catch (err: any) {
      console.error('Failed to delete content item', err);
      return { success: false, message: err?.message || 'Failed to delete the item.' };
    }
  };

  const handleCreateNewItem = async (
    title: string,
    brandId: string,
    contentType: 'post' | 'page',
    opts?: { primaryKeyword?: string; secondaryKeywords?: string[]; sheetContext?: any; seoBrief?: string; initialPrompt?: string; sourceSheetId?: string }
  ) => {
    if (!user) return;
    const brand = brands.find((b) => b.id === brandId) || brands[0];
    const newItemId = `item-${Date.now()}`;
    // Assign the next available blog number for this brand (no duplicates).
    const used = collectUsedNumbers(items, register, brandId);
    const { number: blogNumber } = nextBlogNumber(brand, used);
    const newItem: ContentItem & { userId: string } = {
      id: newItemId,
      userId: user.uid,
      brandId,
      title,
      blogNumber,
      // The seed title is the *brief* — it must not become the article's
      // headline (the theme renders the post title as an h1, so keeping the
      // seed out of the title prevents the recurring duplicate-header issue).
      initialPrompt: opts?.initialPrompt || title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      contentType,
      wpTemplate: brand?.pageTemplates?.[0] || 'default',
      status: 'Planned',
      primaryKeyword: opts?.primaryKeyword || title.split(' ').slice(0, 4).join(' '),
      secondaryKeywords: opts?.secondaryKeywords || [],
      seoBrief: opts?.seoBrief || 'Target audience interest and organic search ranking.',
      sheetContext: opts?.sheetContext || undefined,
      sourceSheetId: opts?.sourceSheetId || undefined,
      bodyHtml: `<h2>${title}</h2><p>Article introduction content generated for ${brand?.name || 'Brand'}.</p>`,
      blocks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      // Optimistically add the item to local state immediately so the editor
      // has something to render before the Firestore onSnapshot catches up.
      setItems((prev) => [...prev, newItem as ContentItem]);
      await setDoc(doc(db, 'content_items', newItemId), sanitizeForFirestore(newItem));
      // Create the matching Blog Register entry so the number is recorded
      // persistently from the moment the post exists.
      await setDoc(doc(db, 'blog_register', newItemId), sanitizeForFirestore(buildRegisterEntry(newItem as ContentItem, brand, user.uid)));
      setActiveItemId(newItem.id);
      setActiveTab('editor');
    } catch (err) {
      console.error('Failed to create new content item', err);
      // Remove the optimistic insert if Firestore write failed
      setItems((prev) => prev.filter((i) => i.id !== newItemId));
    }
  };

  const handleUpdateStatus = async (itemId: string, status: PipelineStatus) => {
    if (!user) return;
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    try {
      const updatedItem = { ...item, status, updatedAt: new Date().toISOString(), userId: user.uid };
      await setDoc(doc(db, 'content_items', itemId), updatedItem);
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const handleEditItem = (item: ContentItem) => {
    setActiveItemId(item.id);
    setSelectedBrandId(item.brandId);
    setActiveTab('editor');
  };

  // Shared shape for importing a real WordPress post into the pipeline.
  // Used by the Dashboard's single-post import AND the Content Hub's bulk pull,
  // so both surfaces always mirror posts identically.
  const buildImportedWpItem = (post: any, brand: Brand): ContentItem & { userId: string } => {
    const now = new Date().toISOString();
    const link = post.link || '';
    return {
      id: `wp-item-${Date.now()}-${post.id}`,
      brandId: brand.id,
      title: post.title?.rendered || 'Imported Post',
      slug: post.slug || '',
      contentType: post.type === 'page' ? 'page' : 'post',
      wpTemplate: 'default',
      status: post.status === 'publish' ? 'Published' : 'Draft_Ready',
      primaryKeyword: '',
      secondaryKeywords: [],
      seoBrief: '',
      bodyHtml: post.content?.rendered || '',
      blocks: [],
      wpPostId: post.id,
      wpLiveUrl: post.status === 'publish' ? link : '',
      wpPreviewUrl: link ? `${link}${link.includes('?') ? '&' : '?'}preview=true` : '',
      createdAt: now,
      updatedAt: now,
      userId: user!.uid,
    };
  };

  const handleImportWPPost = async (post: any) => {
    if (!user) return;

    const brand = brands.find(b => b.id === post.brandId) || brands[0];
    if (!brand) return;

    // Check if we already have it
    let existingItem = items.find(i => i.wpPostId === post.id && i.brandId === brand.id);
    if (existingItem) {
      handleEditItem(existingItem);
      return;
    }

    const newItem = buildImportedWpItem(post, brand);

    try {
      await setDoc(doc(db, 'content_items', newItem.id), newItem);
      setActiveItemId(newItem.id);
      setActiveTab('editor');
    } catch (err) {
      console.error('Failed to import post', err);
    }
  };

  // Bulk import for the Content Hub: mirrors historic WordPress posts (drafts
  // and live ones) as pipeline items WITHOUT navigating — the hub stays put.
  const handleImportWPPosts = async (posts: any[], brand: Brand): Promise<number> => {
    if (!user) return 0;
    let imported = 0;
    for (const post of posts) {
      const existing = items.find((i) => i.wpPostId === post.id && i.brandId === brand.id);
      if (existing) continue;
      const newItem = buildImportedWpItem(post, brand);
      try {
        await setDoc(doc(db, 'content_items', newItem.id), newItem);
        imported++;
      } catch (err) {
        console.error('Failed to import post', err);
      }
    }
    return imported;
  };

  // Find active item & active brand.
  // The editor is brand-scoped: it always shows content for the selected brand,
  // so switching brands (navbar or elsewhere) switches the editor to that
  // brand's own drafts instead of staying pinned to a foreign item.
  const activeItem = useMemo(() => {
    if (activeTab !== 'editor') {
      return items.find((i) => i.id === activeItemId) || items[0] || null;
    }
    const open = items.find((i) => i.id === activeItemId);
    if (open && open.brandId === selectedBrandId) return open;
    const brandItems = items.filter((i) => i.brandId === selectedBrandId);
    if (brandItems.length === 0) return null;
    return [...brandItems].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    )[0];
  }, [items, activeItemId, selectedBrandId, activeTab]);
  const activeBrand = brands.find((b) => b.id === selectedBrandId) || brands[0];

  // Keep the editor's internal selection in sync with the selected brand:
  // switching brand while inside the editor jumps to that brand's newest item.
  useEffect(() => {
    if (activeTab !== 'editor') return;
    const open = items.find((i) => i.id === activeItemId);
    if (open && open.brandId === selectedBrandId) return;
    const brandItems = items.filter((i) => i.brandId === selectedBrandId);
    if (brandItems.length === 0) return; // editor shows the brand empty state
    const newest = [...brandItems].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    )[0];
    setActiveItemId(newest.id);
  }, [selectedBrandId, activeTab, items, activeItemId]);

  // Feature Request Actions
  const handleSaveFeature = async (feature: FeatureRequest) => {
    if (!user) return;
    try {
      const featureToSave = { ...feature, userId: user.uid };
      await setDoc(doc(db, 'feature_requests', feature.id), sanitizeForFirestore(featureToSave));
    } catch (err) {
      console.error('Failed to save feature request', err);
    }
  };

  const handleDeleteFeature = async (featureId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'feature_requests', featureId));
    } catch (err) {
      console.error('Failed to delete feature request', err);
    }
  };

  const plannedCount = items.filter((i) => i.status === 'Planned' || i.status === 'Researching').length;
  const draftCount = items.filter((i) => i.status === 'Draft_Ready' || i.status === 'Generating').length;

  // No login screen in emulator mode: the app auto-authenticates as the workspace owner.
  // In production: show a login screen when auth resolves with no user.
  if (authError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-sm w-full text-center space-y-5">
          <div className="w-14 h-14 bg-red-100 rounded-2xl mx-auto flex items-center justify-center">
            <span className="text-red-600 font-bold text-xl">!</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Could not sign in</h1>
            <p className="text-sm text-slate-500 mt-2">{authError}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 text-white font-semibold text-sm transition hover:bg-slate-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    // Production: show login screen once auth has resolved with no user
    if (authResolved && !USE_EMULATORS) {
      return <LoginScreen />;
    }
    // Emulator or still loading: show spinner
    return (
      <div className="h-[100dvh] bg-[#e9ecef] flex items-center justify-center font-sans">
        <div className="bg-white px-8 py-6 rounded-2xl shadow-sm border border-slate-200 flex items-center space-x-3">
          <span className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold text-slate-600">Signing you in automatically…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-[#e9ecef] flex p-0 md:p-4 font-sans antialiased text-slate-900 overflow-hidden">
      {/* App Shell Container */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-[#f4f6f8] md:rounded-[2rem] shadow-2xl border-0 md:border border-white/40 relative">
        {/* Mobile Sidebar Backdrop */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-30 md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar: fixed drawer on mobile, static rail on desktop */}
        <div
          className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out
            md:static md:translate-x-0 md:z-20 md:transition-none
            ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="h-full bg-white md:rounded-l-[2rem] shadow-2xl md:shadow-sm">
            <Sidebar
              activeTab={activeTab}
              onNavigateTab={navigateTab}
              plannedCount={plannedCount}
              draftCount={draftCount}
              contentCount={items.length}
              featureCount={features.filter(f => f.status !== 'shipped').length}
              collapsed={sidebarCollapsed}
              onToggleCollapse={toggleSidebar}
            />
          </div>
        </div>

        {/* Main Content Column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 bg-transparent">
          {/* Top Navbar */}
          <Navbar
            brands={brands}
            selectedBrandId={selectedBrandId}
            onSelectBrand={setSelectedBrandId}
            onOpenBrandModal={() => setActiveTab('brands')}
            onNavigateTab={navigateTab}
            activeTab={activeTab}
            onToggleSidebar={() => {
              if (window.innerWidth < 768) {
                setMobileSidebarOpen(true);
              } else {
                toggleSidebar();
              }
            }}
            sidebarCollapsed={sidebarCollapsed}
            currentUser={appUser}
          />

          {/* Workspace Content Area */}
          <main className="flex-1 overflow-y-auto bg-transparent p-2 md:p-4">
            {activeTab === 'pipeline' && (
              <Dashboard
                items={items}
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSelectBrand={setSelectedBrandId}
                onEditItem={handleEditItem}
                onDeleteItem={handleDeleteItem}
                onCreateNewItem={handleCreateNewItem}
                onImportWPPost={handleImportWPPost}
              />
            )}

            {activeTab === 'editor' && (
              <ZenEditor
                item={activeItem}
                brand={activeItem ? brands.find((b) => b.id === activeItem.brandId) || activeBrand : activeBrand}
                onSaveItem={handleSaveItem}
                onSyncToWP={async (item) => {
                  handleSaveItem(item);
                }}
                onCreateNewItem={handleCreateNewItem}
                items={items}
              />
            )}

            {activeTab === 'nano-banana' && (
              <NanoBananaStudioModal brands={brands} selectedBrandId={selectedBrandId} />
            )}

            {activeTab === 'content-hub' && (
              <ContentHub
                items={items}
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSelectBrand={setSelectedBrandId}
                onEditItem={handleEditItem}
                onSaveItem={handleSaveItem}
                onCreateNewItem={handleCreateNewItem}
                onDeleteItem={handleDeleteItem}
                onImportWPPosts={handleImportWPPosts}
                onNavigateTab={navigateTab}
                register={register}
              />
            )}

            {activeTab === 'brands' && (
              <BrandManager
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSaveBrand={handleSaveBrand}
                onDeleteBrand={handleDeleteBrand}
                onSelectBrand={setSelectedBrandId}
              />
            )}

            {activeTab === 'autoblog' && (
              <AutoBlogScheduler
                items={items}
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSaveItem={handleSaveItem}
                onCreateNewItem={handleCreateNewItem}
                onDeleteItem={handleDeleteItem}
                onEditItem={handleEditItem}
              />
            )}

            {activeTab === 'features' && (
              <FeatureTracker
                features={features}
                onSave={handleSaveFeature}
                onDelete={handleDeleteFeature}
              />
            )}

            {activeTab === 'settings' && (
            <SettingsTab
              brands={brands}
              selectedBrandId={selectedBrandId}
              currentUser={appUser}
            />
          )}
          </main>
        </div>
      </div>
    </div>
  );
}
