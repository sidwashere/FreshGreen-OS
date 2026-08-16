import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ZenEditor } from './components/ZenEditor';
import { ContentHub } from './components/ContentHub';
import { BrandManager } from './components/BrandManager';
import { NanoBananaStudioModal } from './components/NanoBananaStudioModal';
import { WorkspaceHub } from './components/WorkspaceHub';
import { SettingsTab } from './components/SettingsTab';
import { INITIAL_BRANDS, INITIAL_CONTENT } from './data/initialData';
import { Brand, ContentItem, PipelineStatus, AppUser } from './types';
import { initAuth, usernameSignIn, createUsernameUser, logout, db } from './lib/firebase';
import { LoginScreen, LoginMode } from './components/LoginScreen';
import { User } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';

export default function App() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);

  const [selectedBrandId, setSelectedBrandId] = useState<string>('dtp-brand');
  const [activeTab, setActiveTab] = useState<string>('pipeline');
  const [activeItemId, setActiveItemId] = useState<string>('item-1');

  // Sidebar state: desktop collapse (persisted) + mobile drawer
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('greenops_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('greenops_sidebar_collapsed', next ? '1' : '0');
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

  const [needsAuth, setNeedsAuth] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<LoginMode>('signin');
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);

  // First-run detection: no admin exists yet → the first registration becomes admin
  useEffect(() => {
    let cancelled = false;
    const checkBootstrap = async () => {
      try {
        const snap = await getDoc(doc(db, 'app_meta', 'bootstrap'));
        if (!cancelled) setIsFirstRun(!snap.exists());
      } catch {
        if (!cancelled) setIsFirstRun(false); // can't check — assume initialized
      }
    };
    checkBootstrap();
    return () => { cancelled = true; };
  }, [needsAuth]);

  // Read the user's app_users profile and decide approved / pending / legacy
  const checkApproval = async (u: User): Promise<AppUser | null> => {
    const ref = doc(db, 'app_users', u.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const profile = { id: u.uid, ...snap.data() } as AppUser;
      setAppUser(profile);
      return profile;
    }
    // Legacy account (e.g. previously signed in with Google): no profile yet.
    // Auto-create an approved member profile so existing users aren't locked out.
    const isLegacy = !(u.email || '').endsWith('@greenops.local');
    if (isLegacy) {
      const profile: AppUser = {
        id: u.uid,
        username: (u.email || 'user').split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') || 'user',
        role: 'member',
        approved: true,
        createdAt: new Date().toISOString(),
        userId: u.uid,
      };
      await setDoc(ref, profile as any);
      setAppUser(profile);
      return profile;
    }
    setAppUser(null);
    return null;
  };

  const handleAuthUser = async (authUser: User) => {
    setUser(authUser);
    setLoginError(null);
    setPendingApproval(true);
    setNeedsAuth(true);
    const profile = await checkApproval(authUser);
    if (profile && profile.approved) {
      setPendingApproval(false);
      setNeedsAuth(false);
    }
  };

  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser) => { handleAuthUser(authUser); },
      () => {
        setUser(null);
        setAppUser(null);
        setPendingApproval(false);
        setNeedsAuth(true);
        setBrands([]);
        setItems([]);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleAuthSubmit = async (username: string, password: string) => {
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      if (authMode === 'signin') {
        // Triggers onAuthStateChanged → handleAuthUser → approval check
        await usernameSignIn(username, password);
      } else {
        const { user: newUser } = await createUsernameUser(username, password);
        const isAdmin = isFirstRun === true;
        await setDoc(doc(db, 'app_users', newUser.uid), {
          username: username.trim(),
          role: isAdmin ? 'admin' : 'member',
          approved: isAdmin,
          createdAt: new Date().toISOString(),
          userId: newUser.uid,
        });
        if (isAdmin) {
          await setDoc(doc(db, 'app_meta', 'bootstrap'), {
            initialized: true,
            adminUid: newUser.uid,
            at: new Date().toISOString(),
          });
        }
        await handleAuthUser(newUser);
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
        setLoginError('Incorrect username or password.');
      } else if (code === 'auth/email-already-in-use') {
        setLoginError('That username is already taken — try signing in instead.');
      } else if (code === 'auth/weak-password') {
        setLoginError('Password too weak — use at least 6 characters.');
      } else if (code === 'auth/too-many-requests') {
        setLoginError('Too many attempts — wait a moment and try again.');
      } else {
        setLoginError(err?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
  };

  useEffect(() => {
    if (!user) return;
    
    // One-time check for new user seeding
    const checkAndSeed = async () => {
      const storageKey = `greenops_seeded_${user.uid}`;
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

    return () => {
      unsubscribeBrands();
      unsubscribeItems();
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
    opts?: { primaryKeyword?: string; secondaryKeywords?: string[] }
  ) => {
    if (!user) return;
    const brand = brands.find((b) => b.id === brandId) || brands[0];
    const newItemId = `item-${Date.now()}`;
    const newItem: ContentItem & { userId: string } = {
      id: newItemId,
      userId: user.uid,
      brandId,
      title,
      // The seed title is the *brief* — it must not become the article's
      // headline (the theme renders the post title as an h1, so keeping the
      // seed out of the title prevents the recurring duplicate-header issue).
      initialPrompt: title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      contentType,
      wpTemplate: brand?.pageTemplates?.[0] || 'default',
      status: 'Planned',
      primaryKeyword: opts?.primaryKeyword || title.split(' ').slice(0, 4).join(' '),
      secondaryKeywords: opts?.secondaryKeywords || [],
      seoBrief: 'Target audience interest and organic search ranking.',
      bodyHtml: `<h2>${title}</h2><p>Article introduction content generated for ${brand?.name || 'Brand'}.</p>`,
      blocks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'content_items', newItemId), newItem);
      setActiveItemId(newItem.id);
      setActiveTab('editor');
    } catch (err) {
      console.error('Failed to create new content item', err);
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

  const plannedCount = items.filter((i) => i.status === 'Planned' || i.status === 'Researching').length;
  const draftCount = items.filter((i) => i.status === 'Draft_Ready' || i.status === 'Generating').length;

  if (needsAuth) {
    if (pendingApproval && appUser === null) {
      // Signed in but no approved profile yet (fresh request or legacy name conflict)
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans p-4">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-sm w-full text-center space-y-5">
            <div className="w-14 h-14 bg-amber-100 rounded-2xl mx-auto flex items-center justify-center">
              <span className="text-amber-600 font-bold text-xl">⏳</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Awaiting approval</h1>
              <p className="text-sm text-slate-500 mt-2">
                Your account is registered but hasn't been approved by an administrator yet.
                Ask your admin to approve it in <strong>Settings → User Management</strong>, then reload.
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-800 text-white font-semibold text-sm transition hover:bg-slate-700"
            >
              Check again
            </button>
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-semibold text-sm transition hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      );
    }

    return (
      <LoginScreen
        mode={authMode}
        onModeChange={setAuthMode}
        onSubmit={handleAuthSubmit}
        error={loginError}
        busy={isLoggingIn}
        isFirstRun={isFirstRun === true}
      />
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

            {activeTab === 'workspace' && <WorkspaceHub />}

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
