import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Building2, Plus, Trash2, ExternalLink, Loader2, Upload, ImageIcon, Check,
  UserCircle, Eye, Pencil, ExternalLinkIcon, Sparkles,
} from "lucide-react";
import { useActiveBrand } from "@/hooks/useActiveBrand";

interface BrandAccount {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  website_url: string | null;
  link_label: string | null;
  is_verified: boolean;
  is_active: boolean;
  views: number;
  created_at: string;
}

const MAX_BRANDS = 20;
const MAX_FILE_MB = 5;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default function BrandAccounts() {
  const [user, setUser] = useState<any>(null);
  const [brands, setBrands] = useState<BrandAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BrandAccount | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", website_url: "", link_label: "", bio: "" });
  const [form, setForm] = useState({
    name: "",
    handle: "",
    description: "",
    website_url: "",
    link_label: "",
  });
  const navigate = useNavigate();
  const { activeBrandId, setActiveBrandId } = useActiveBrand();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      setUser(session.user);
      await loadBrands(session.user.id);
    })();
  }, []);

  const loadBrands = async (uid: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("brand_accounts")
      .select("*")
      .eq("owner_user_id", uid)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Не удалось загрузить аккаунты бренда");
    } else {
      setBrands((data as any) || []);
    }
    setLoading(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (brands.length >= MAX_BRANDS) {
      toast.error(`Лимит ${MAX_BRANDS} аккаунтов бренда достигнут`);
      return;
    }
    const handle = form.handle.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!form.name.trim() || !handle) {
      toast.error("Заполните имя и handle");
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("brand_accounts").insert({
      owner_user_id: user.id,
      name: form.name.trim(),
      handle,
      description: form.description.trim() || null,
      website_url: form.website_url.trim() || null,
      link_label: form.link_label.trim() || null,
    });
    setCreating(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Handle уже занят" : error.message);
      return;
    }
    toast.success("Аккаунт бренда создан");
    setForm({ name: "", handle: "", description: "", website_url: "", link_label: "" });
    await loadBrands(user.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить аккаунт бренда? Действие необратимо.")) return;
    if (activeBrandId === id) setActiveBrandId(null);
    const { error } = await supabase.from("brand_accounts").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Удалено");
    if (user) await loadBrands(user.id);
  };

  const toggleActiveStatus = async (b: BrandAccount) => {
    const { error } = await supabase
      .from("brand_accounts")
      .update({ is_active: !b.is_active })
      .eq("id", b.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(!b.is_active ? "Бренд активирован" : "Бренд деактивирован");
    if (user) await loadBrands(user.id);
  };

  const openEdit = (b: BrandAccount) => {
    setEditing(b);
    setEditForm({
      name: b.name,
      description: b.description || "",
      website_url: b.website_url || "",
      link_label: b.link_label || "",
      bio: b.bio || "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { error } = await supabase
      .from("brand_accounts")
      .update({
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        website_url: editForm.website_url.trim() || null,
        link_label: editForm.link_label.trim() || null,
        bio: editForm.bio.trim() || null,
      })
      .eq("id", editing.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Сохранено");
    setEditing(null);
    if (user) await loadBrands(user.id);
  };

  const handleMediaUpload = async (
    brand: BrandAccount,
    kind: "avatar" | "cover",
    file: File,
    retries = 1
  ) => {
    if (!user) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Недопустимый формат. Используй JPG, PNG, WEBP или GIF.");
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`Размер файла не должен превышать ${MAX_FILE_MB} МБ. Сожми изображение и попробуй снова.`);
      return;
    }
    setUploadingId(`${brand.id}-${kind}`);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${user.id}/brands/${brand.id}/${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("profile-covers")
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("profile-covers").getPublicUrl(path);
      const column = kind === "avatar" ? "avatar_url" : "cover_url";
      const { error: updErr } = await supabase
        .from("brand_accounts")
        .update({ [column]: publicUrl })
        .eq("id", brand.id);
      if (updErr) throw updErr;
      toast.success(kind === "avatar" ? "Аватарка обновлена" : "Обложка обновлена");
      await loadBrands(user.id);
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Retry once on transient network errors without losing the file selection
      if (retries > 0 && /network|fetch|timeout|temporar/i.test(msg)) {
        toast.message("Сеть нестабильна — повторяю...");
        setUploadingId(null);
        return handleMediaUpload(brand, kind, file, retries - 1);
      }
      if (/payload too large|exceed/i.test(msg)) {
        toast.error("Файл слишком большой для сервера. Сожми изображение.");
      } else if (/permission|denied|policy/i.test(msg)) {
        toast.error("Нет прав на загрузку. Перезайди в аккаунт и попробуй снова.");
      } else if (/mime|content.type/i.test(msg)) {
        toast.error("Неподдерживаемый тип файла.");
      } else {
        toast.error(`Не удалось загрузить: ${msg}`);
      }
    } finally {
      setUploadingId(null);
    }
  };

  const handleSwitchBrand = (brand: BrandAccount | null) => {
    if (brand) {
      setActiveBrandId(brand.id);
      toast.success(`Активен бренд: ${brand.name}`);
    } else {
      setActiveBrandId(null);
      toast.success("Вернулись на личный аккаунт");
    }
  };

  const activeCount = brands.filter((b) => b.is_active).length;
  const totalViews = brands.reduce((s, b) => s + (b.views || 0), 0);

  return (
    <div className="min-h-screen bg-background">
      <Header user={user} />
      <main className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Building2 className="h-7 w-7 text-primary" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Аккаунты бренда</h1>
            <p className="text-sm text-muted-foreground">
              {brands.length} / {MAX_BRANDS} • активных: {activeCount} • просмотров: {totalViews}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/business"><Sparkles className="h-4 w-4 mr-1" /> О бизнесе</Link>
          </Button>
          {activeBrandId && (
            <Button variant="outline" size="sm" onClick={() => handleSwitchBrand(null)}>
              <UserCircle className="h-4 w-4 mr-1" /> На личный
            </Button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold">{brands.length}</div>
            <div className="text-xs text-muted-foreground">Всего</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold text-primary">{activeCount}</div>
            <div className="text-xs text-muted-foreground">Активных</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold">{totalViews}</div>
            <div className="text-xs text-muted-foreground">Просмотров</div>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" /> Создать новый аккаунт
            </CardTitle>
            <CardDescription>
              После создания загрузи аватарку и обложку ниже. Никнейм бренда никогда не сбрасывается.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="name">Название</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Brand Inc." maxLength={60} required />
                </div>
                <div>
                  <Label htmlFor="handle">Handle</Label>
                  <Input id="handle" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="my-brand" maxLength={30} required />
                </div>
              </div>
              <div>
                <Label htmlFor="desc">Описание</Label>
                <Textarea id="desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Кратко о бренде" maxLength={500} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="website">Ссылка</Label>
                  <Input id="website" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} placeholder="https://your-site.com" />
                </div>
                <div>
                  <Label htmlFor="label">Подпись ссылки</Label>
                  <Input id="label" value={form.link_label} onChange={(e) => setForm({ ...form, link_label: e.target.value })} placeholder="Наш сайт" maxLength={40} />
                </div>
              </div>
              <Button type="submit" disabled={creating || brands.length >= MAX_BRANDS}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Создать
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Мои бренды</h2>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : brands.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Пока нет аккаунтов бренда</p>
          ) : (
            brands.map((b) => {
              const isActive = activeBrandId === b.id;
              return (
                <Card key={b.id} className={isActive ? "border-primary" : ""}>
                  {b.cover_url && (
                    <div className="h-24 rounded-t-lg bg-cover bg-center" style={{ backgroundImage: `url(${b.cover_url})` }} />
                  )}
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-14 w-14">
                        <AvatarImage src={b.avatar_url || undefined} />
                        <AvatarFallback>{b.name[0]?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link to={`/brand/${b.handle}`} className="font-semibold truncate hover:underline">{b.name}</Link>
                          <Badge variant="secondary" className="text-xs">@{b.handle}</Badge>
                          {b.is_verified && <Badge className="text-xs">✓ Verified</Badge>}
                          {isActive && <Badge variant="default" className="text-xs">Активный</Badge>}
                          <Badge variant={b.is_active ? "outline" : "destructive"} className="text-xs cursor-pointer" onClick={() => toggleActiveStatus(b)}>
                            {b.is_active ? "Видимый" : "Скрыт"}
                          </Badge>
                        </div>
                        {b.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{b.description}</p>}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> {b.views}</span>
                          {b.website_url && (
                            <a href={b.website_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                              <ExternalLink className="h-3 w-3" />
                              {b.link_label || "Ссылка"}
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(b)} aria-label="Редактировать">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(b.id)} aria-label="Удалить">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                      <label className="cursor-pointer">
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
                          onChange={(e) => e.target.files?.[0] && handleMediaUpload(b, "avatar", e.target.files[0])} />
                        <span className="inline-flex items-center justify-center gap-1 w-full text-xs h-9 rounded-md border border-input hover:bg-accent">
                          {uploadingId === `${b.id}-avatar` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                          Аватарка
                        </span>
                      </label>
                      <label className="cursor-pointer">
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
                          onChange={(e) => e.target.files?.[0] && handleMediaUpload(b, "cover", e.target.files[0])} />
                        <span className="inline-flex items-center justify-center gap-1 w-full text-xs h-9 rounded-md border border-input hover:bg-accent">
                          {uploadingId === `${b.id}-cover` ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
                          Обложка
                        </span>
                      </label>
                      <Button size="sm" variant="outline" asChild className="text-xs">
                        <Link to={`/brand/${b.handle}`}><ExternalLinkIcon className="h-3 w-3 mr-1" />Профиль</Link>
                      </Button>
                      <Button size="sm" variant={isActive ? "secondary" : "default"} onClick={() => handleSwitchBrand(isActive ? null : b)} className="text-xs">
                        {isActive ? <><Check className="h-3 w-3 mr-1" /> Активен</> : "Сделать активным"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </main>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать «{editing?.name}»</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Название</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} maxLength={60} />
            </div>
            <div>
              <Label>Описание</Label>
              <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} maxLength={500} />
            </div>
            <div>
              <Label>Био (как у обычного профиля)</Label>
              <Textarea value={editForm.bio} onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })} maxLength={1000} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Ссылка</Label>
                <Input value={editForm.website_url} onChange={(e) => setEditForm({ ...editForm, website_url: e.target.value })} />
              </div>
              <div>
                <Label>Подпись ссылки</Label>
                <Input value={editForm.link_label} onChange={(e) => setEditForm({ ...editForm, link_label: e.target.value })} maxLength={40} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
            <Button onClick={saveEdit}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
