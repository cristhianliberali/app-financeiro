import {
  Activity,
  Baby,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  Beaker,
  Bike,
  Bitcoin,
  BookOpen,
  Briefcase,
  Building2,
  Bus,
  Camera,
  Car,
  Cat,
  Church,
  Clapperboard,
  Code2,
  Coffee,
  Coins,
  Compass,
  CreditCard,
  Dog,
  Droplets,
  Dumbbell,
  Flame,
  Folder,
  Fuel,
  Gamepad2,
  Gift,
  Globe,
  GraduationCap,
  HandCoins,
  Handshake,
  Heart,
  Home,
  Landmark,
  Laptop,
  Layers,
  Leaf,
  Lightbulb,
  LineChart,
  Megaphone,
  Music,
  Package,
  PaintRoller,
  Palette,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Puzzle,
  Receipt,
  Rocket,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Shirt,
  Smartphone,
  Sparkles,
  Stethoscope,
  Target,
  Ticket,
  TrendingUp,
  TreePine,
  Truck,
  UtensilsCrossed,
  Users,
  Wallet,
  Wifi,
  Wine,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Banco de ícones do sistema.
 *
 * Categorias de Finanças e espaços de Tarefas eram marcados com emoji: cada
 * sistema operacional desenhava o seu, em cores que ninguém escolheu e num
 * traço que não combinava com o resto da interface. Aqui a marca é um ícone do
 * Lucide — mesmo traço, mesma espessura, e a cor vem do item, não do emoji.
 *
 * O banco guarda **nomes** (`"home"`, `"salary"`), não componentes: é o nome
 * que vai para o banco de dados, nas mesmas colunas que antes guardavam o
 * emoji. Trocar o desenho de um ícone depois é mexer só nesta tabela.
 */

type IconEntry = {
  /** Chave gravada no banco. */
  name: string;
  icon: LucideIcon;
  /** Rótulo em português, usado na busca do seletor. */
  label: string;
};

/**
 * Grupos do seletor. A ordem aqui é a ordem na tela: o que mais se usa para
 * marcar uma categoria ou um espaço vem primeiro.
 */
export const ICON_GROUPS: Array<{ label: string; icons: IconEntry[] }> = [
  {
    label: "Casa e contas",
    icons: [
      { name: "home", icon: Home, label: "Casa moradia aluguel" },
      { name: "zap", icon: Zap, label: "Energia luz elétrica" },
      { name: "droplets", icon: Droplets, label: "Água conta" },
      { name: "flame", icon: Flame, label: "Gás botijão" },
      { name: "wifi", icon: Wifi, label: "Internet wifi" },
      { name: "smartphone", icon: Smartphone, label: "Celular telefone" },
      { name: "receipt", icon: Receipt, label: "Conta boleto nota" },
      { name: "package", icon: Package, label: "Encomenda entrega" },
    ],
  },
  {
    label: "Dia a dia",
    icons: [
      { name: "utensils", icon: UtensilsCrossed, label: "Comida alimentação restaurante" },
      { name: "shopping-cart", icon: ShoppingCart, label: "Mercado compras supermercado" },
      { name: "shopping-bag", icon: ShoppingBag, label: "Compras loja sacola" },
      { name: "coffee", icon: Coffee, label: "Café lanche padaria" },
      { name: "wine", icon: Wine, label: "Bebida bar vinho" },
      { name: "shirt", icon: Shirt, label: "Roupa vestuário" },
      { name: "scissors", icon: Scissors, label: "Salão cabelo beleza" },
      { name: "gift", icon: Gift, label: "Presente aniversário" },
    ],
  },
  {
    label: "Transporte",
    icons: [
      { name: "car", icon: Car, label: "Carro automóvel" },
      { name: "fuel", icon: Fuel, label: "Combustível gasolina posto" },
      { name: "bus", icon: Bus, label: "Ônibus transporte público" },
      { name: "bike", icon: Bike, label: "Bicicleta moto" },
      { name: "plane", icon: Plane, label: "Viagem avião passagem" },
      { name: "truck", icon: Truck, label: "Frete caminhão logística" },
    ],
  },
  {
    label: "Saúde e bem-estar",
    icons: [
      { name: "pill", icon: Pill, label: "Remédio farmácia" },
      { name: "stethoscope", icon: Stethoscope, label: "Médico consulta saúde" },
      { name: "heart", icon: Heart, label: "Saúde plano coração" },
      { name: "dumbbell", icon: Dumbbell, label: "Academia treino esporte" },
      { name: "activity", icon: Activity, label: "Exame atividade" },
      { name: "leaf", icon: Leaf, label: "Bem-estar natural" },
    ],
  },
  {
    label: "Lazer e estudo",
    icons: [
      { name: "clapperboard", icon: Clapperboard, label: "Cinema filme streaming" },
      { name: "music", icon: Music, label: "Música show" },
      { name: "gamepad", icon: Gamepad2, label: "Jogo game" },
      { name: "ticket", icon: Ticket, label: "Ingresso evento" },
      { name: "book", icon: BookOpen, label: "Livro leitura" },
      { name: "graduation", icon: GraduationCap, label: "Estudo faculdade curso" },
      { name: "camera", icon: Camera, label: "Foto câmera" },
      { name: "tree", icon: TreePine, label: "Passeio parque natureza" },
    ],
  },
  {
    label: "Família e pets",
    icons: [
      { name: "baby", icon: Baby, label: "Bebê filho criança" },
      { name: "users", icon: Users, label: "Família pessoas equipe" },
      { name: "cat", icon: Cat, label: "Gato pet" },
      { name: "dog", icon: Dog, label: "Cachorro pet" },
      { name: "paw", icon: PawPrint, label: "Pet animal veterinário" },
      { name: "church", icon: Church, label: "Igreja doação dízimo" },
    ],
  },
  {
    label: "Dinheiro",
    icons: [
      { name: "wallet", icon: Wallet, label: "Carteira saldo" },
      { name: "banknote", icon: Banknote, label: "Dinheiro nota salário" },
      { name: "briefcase", icon: Briefcase, label: "Trabalho salário emprego" },
      { name: "hand-coins", icon: HandCoins, label: "Freelance renda extra" },
      { name: "coins", icon: Coins, label: "Moedas reserva" },
      { name: "piggy-bank", icon: PiggyBank, label: "Poupança guardar" },
      { name: "credit-card", icon: CreditCard, label: "Cartão de crédito fatura" },
      { name: "landmark", icon: Landmark, label: "Banco imposto governo" },
      { name: "trending-up", icon: TrendingUp, label: "Investimento rendimento" },
      { name: "line-chart", icon: LineChart, label: "Ações bolsa gráfico" },
      { name: "bitcoin", icon: Bitcoin, label: "Cripto bitcoin" },
      { name: "dollar-badge", icon: BadgeDollarSign, label: "Venda receita comissão" },
    ],
  },
  {
    label: "Trabalho e projetos",
    icons: [
      { name: "folder", icon: Folder, label: "Pasta espaço geral" },
      { name: "megaphone", icon: Megaphone, label: "Marketing divulgação" },
      { name: "code", icon: Code2, label: "Desenvolvimento código" },
      { name: "laptop", icon: Laptop, label: "Computador escritório" },
      { name: "target", icon: Target, label: "Meta objetivo" },
      { name: "rocket", icon: Rocket, label: "Lançamento produto" },
      { name: "puzzle", icon: Puzzle, label: "Integração peça" },
      { name: "building", icon: Building2, label: "Empresa escritório" },
      { name: "wrench", icon: Wrench, label: "Manutenção suporte" },
      { name: "palette", icon: Palette, label: "Design criação" },
      { name: "bar-chart", icon: BarChart3, label: "Relatório dados análise" },
      { name: "handshake", icon: Handshake, label: "Comercial parceria vendas" },
      { name: "lightbulb", icon: Lightbulb, label: "Ideia inovação" },
      { name: "beaker", icon: Beaker, label: "Pesquisa experimento" },
      { name: "shield", icon: ShieldCheck, label: "Segurança jurídico" },
      { name: "layers", icon: Layers, label: "Plataforma camadas" },
      { name: "globe", icon: Globe, label: "Site web global" },
      { name: "compass", icon: Compass, label: "Estratégia direção" },
      { name: "sparkles", icon: Sparkles, label: "Novo destaque" },
      { name: "paint-roller", icon: PaintRoller, label: "Reforma obra pintura" },
    ],
  },
];

const BY_NAME: Record<string, LucideIcon> = Object.fromEntries(
  ICON_GROUPS.flatMap((g) => g.icons).map((entry) => [entry.name, entry.icon]),
);

/** Todos os nomes disponíveis, na ordem dos grupos. */
export const ICON_NAMES = ICON_GROUPS.flatMap((g) => g.icons.map((i) => i.name));

/** Ícone usado quando o item não escolheu nenhum. */
export const DEFAULT_CATEGORY_ICON = "receipt";
export const DEFAULT_SPACE_ICON = "folder";

/**
 * Emojis gravados antes do banco de ícones existir.
 *
 * Os dados antigos continuam no banco com o emoji na coluna `emoji`/`icon`, e
 * apagá-los apagaria a escolha de quem já organizou as suas categorias. Cada
 * emoji que o app já ofereceu vira o ícone equivalente na leitura; a gravação
 * seguinte substitui o valor pelo nome novo.
 */
const LEGACY_EMOJI: Record<string, string> = {
  "🏠": "home",
  "🍕": "utensils",
  "🚗": "car",
  "🎬": "clapperboard",
  "💊": "pill",
  "💼": "briefcase",
  "🧾": "hand-coins",
  "💰": "banknote",
  "💸": "receipt",
  "📁": "folder",
  "📣": "megaphone",
  "💻": "code",
  "🎯": "target",
  "🧩": "puzzle",
  "🏢": "building",
  "🛠️": "wrench",
  "🛠": "wrench",
  "🎨": "palette",
  "📊": "bar-chart",
  "🤝": "handshake",
};

/**
 * Resolve o que estiver gravado no item — nome novo ou emoji antigo — para um
 * componente de ícone. Nunca devolve nulo: sem marca, o item recebe `fallback`.
 */
export function iconOf(value: string | null | undefined, fallback = DEFAULT_CATEGORY_ICON) {
  if (value) {
    const direct = BY_NAME[value];
    if (direct) return direct;
    const legacy = LEGACY_EMOJI[value.trim()];
    if (legacy && BY_NAME[legacy]) return BY_NAME[legacy]!;
  }
  return BY_NAME[fallback] ?? Receipt;
}

/** O mesmo que `iconOf`, mas devolvendo o nome — para gravar de volta. */
export function iconNameOf(value: string | null | undefined, fallback = DEFAULT_CATEGORY_ICON) {
  if (value) {
    if (BY_NAME[value]) return value;
    const legacy = LEGACY_EMOJI[value.trim()];
    if (legacy) return legacy;
  }
  return fallback;
}

/**
 * Ícone de um item, já dentro do seu quadradinho colorido.
 *
 * É a marca visual de categorias, espaços e quadros em toda a interface: a cor
 * do item pinta o traço e um véu dela pinta o fundo, então dois itens de cores
 * diferentes se distinguem à distância sem precisar ler o nome.
 */
export function IconBadge({
  name,
  color,
  size = "md",
  className,
  fallback = DEFAULT_CATEGORY_ICON,
}: {
  name: string | null | undefined;
  /** Cor do item (hex do banco). Sem cor, usa a cor da marca. */
  color?: string | null | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  className?: string | undefined;
  fallback?: string | undefined;
}) {
  const Icon = iconOf(name, fallback);
  const box =
    size === "sm"
      ? "size-6 rounded-md"
      : size === "lg"
        ? "size-11 rounded-xl"
        : "size-9 rounded-lg";
  const glyph = size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center border transition-colors",
        box,
        className,
      )}
      style={
        color
          ? {
              color,
              backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
              borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
            }
          : {
              color: "var(--color-primary)",
              backgroundColor: "var(--color-primary-soft)",
              borderColor: "color-mix(in oklab, var(--color-primary) 24%, transparent)",
            }
      }
      aria-hidden
    >
      <Icon className={glyph} strokeWidth={2} />
    </span>
  );
}
