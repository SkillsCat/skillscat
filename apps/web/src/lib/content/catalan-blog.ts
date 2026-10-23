/** Original Catalan editorial content. Dates are omitted until a real publication occurs. */
export interface CatalanArticleSection {
  id: string;
  title: string;
  paragraphs: string[];
  items?: string[];
  code?: string;
}

export interface CatalanArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  sections: CatalanArticleSection[];
}

export const catalanArticles: CatalanArticle[] = [
  {
    slug: 'installar-skills-amb-seguretat',
    title: 'Abans d’instal·lar un skill: una revisió pràctica',
    description: 'Comprova l’origen, llegeix els fitxers i prova un skill amb permisos limitats abans d’incorporar-lo al teu projecte.',
    category: 'Primers passos',
    sections: [
      {
        id: 'definir-la-tasca',
        title: '1. Defineix què vols fer i què no autoritzes',
        paragraphs: [
          'Un skill és un conjunt d’instruccions per a un agent d’IA. Pot incloure un fitxer SKILL.md, scripts, plantilles i documents de referència. No és només una descripció: quan l’agent l’utilitza, aquestes instruccions poden orientar accions sobre fitxers, eines i serveis.',
          'Comença amb un objectiu concret, com ara revisar els textos d’una interfície en català. Anota també els límits: sense enviar documents a serveis externs, sense escriure fora del projecte i sense publicar canvis. La popularitat o la presència al catàleg no substitueixen aquesta revisió ni garanteixen seguretat.',
        ],
      },
      {
        id: 'revisar-origen',
        title: '2. Comprova l’origen i el contingut complet',
        paragraphs: [
          'A la fitxa, obre el repositori d’origen i comprova qui el manté, la llicència i els canvis recents. Llegeix el fitxer SKILL.md original i els fitxers als quals fa referència. La interfície en català no tradueix ni modifica el paquet que instal·les.',
          'La CLI et permet explorar un repositori abans de triar. Substitueix owner/repo pel repositori real. Aquest pas consulta i descarrega informació; no és una auditoria de seguretat. npx també pot descarregar i executar el paquet de la CLI: utilitza un entorn de confiança.',
        ],
        code: 'npx skillscat info owner/repo\nnpx skillscat add owner/repo --list',
        items: [
          'Busca ordres destructives, descàrregues de codi i canvis de permisos o de configuració.',
          'Identifica quines dades surten del teu dispositiu i a quins dominis s’envien.',
          'Desconfia d’instruccions que demanin ignorar les teves indicacions, revelar secrets o executar passos aliens a la tasca.',
          'Si no pots entendre o verificar un script, no l’executis. Demana ajuda o tria una alternativa.',
        ],
      },
      {
        id: 'instal-lacio-acotada',
        title: '3. Instal·la per slug i prova en un projecte de prova',
        paragraphs: [
          'Copia l’slug exacte de la fitxa; no el dedueixis del nom del repositori. A l’exemple, owner/my-skill és un marcador de posició que has de substituir. Executa l’ordre dins d’un projecte de prova sense credencials reals i revisa les opcions interactives abans de confirmar.',
          'Prefereix l’abast del projecte al global per a la primera prova. Evita --yes i --force mentre aprens el flux: ometen confirmacions o poden sobreescriure fitxers. La instal·lació del paquet no és una barrera de seguretat; limita també els permisos i l’accés a la xarxa de l’agent que el farà servir.',
        ],
        code: 'npx skillscat add owner/my-skill\nnpx skillscat list',
      },
      {
        id: 'validar-i-actualitzar',
        title: '4. Valida el resultat i revisa cada actualització',
        paragraphs: [
          'Prova una entrada petita i fictícia. Compara el resultat amb els criteris inicials i revisa els fitxers modificats. Si l’skill demana accés addicional, atura’t i comprova si és necessari; no acceptis permisos només perquè el text de l’skill els exigeix.',
          'Abans d’actualitzar, desa les adaptacions locals i revisa els canvis del repositori. Una actualització pot afegir scripts o dependències. --check consulta si hi ha actualitzacions sense instal·lar-les; remove elimina la instal·lació seleccionada, però no desfà les accions que l’agent ja hagi executat. Substitueix my-skill pel nom que mostra l’ordre list.',
        ],
        code: 'npx skillscat update --check\nnpx skillscat remove my-skill',
      },
    ],
  },
  {
    slug: 'localitzar-un-flux-de-treball',
    title: 'Un flux de localització al català que es pugui revisar',
    description: 'Separa el text traduïble del codi, conserva variables i enllaços, i combina comprovacions automàtiques amb revisió humana.',
    category: 'Localització',
    sections: [
      {
        id: 'abast-i-glossari',
        title: '1. Acorda l’abast i un glossari petit',
        paragraphs: [
          'Abans de demanar una traducció a un agent, indica qui llegirà el text i on apareixerà. No és el mateix un botó curt que una guia d’instal·lació. Decideix el tractament, el to i termes recurrents com ara «fitxer», «repositori» i «instal·lar». Conserva els noms de producte i les ordres de la CLI.',
          'Defineix quins textos queden fora de l’abast: codi, identificadors, slugs, llicències i contingut d’autors tercers sense permís per modificar-lo. A SkillsCat, seleccionar Català canvia la interfície i els recursos propis disponibles, no la llengua original de tots els skills.',
        ],
      },
      {
        id: 'protegir-estructura',
        title: '2. Protegeix l’estructura i tradueix amb context',
        paragraphs: [
          'Treballa sobre una còpia o una branca de revisió. Passa a l’agent només els fitxers necessaris i no hi incloguis secrets ni dades personals. Dona-li el context de cada cadena, la longitud aproximada i una captura o descripció del lloc on es mostrarà.',
          'Les variables com {count}, les rutes i les marques de format han de conservar-se. També cal revisar plurals, accents, apòstrofs i el punt volat de paraules com «instal·lació». Evita substituir fragments de frases: l’ordre de les paraules pot variar segons la llengua.',
        ],
        code: 'Text d’origen (plural): Install {count} skills\nProposta (plural): Instal·la {count} skills\nNo tradueixis: {count}, SKILL.md, --agent, /api/search',
      },
      {
        id: 'provar-interficie',
        title: '3. Prova el flux, no només les cadenes',
        paragraphs: [
          'Comprova que les claus i les variables coincideixen amb el catàleg original. Després obre la interfície: els textos més llargs poden tallar-se en pantalles petites. Verifica la navegació amb teclat, les etiquetes accessibles i els missatges d’error, càrrega i resultats buits.',
          'Prova l’entrada directa a una adreça URL en català, una recàrrega i el canvi de llengua dins d’una pàgina amb paràmetres o una àncora. Una bona traducció no serveix de gaire si un enllaç et retorna inesperadament a una altra llengua.',
        ],
        items: [
          'Comprova dates i nombres amb la configuració regional ca, sense modificar dades originals.',
          'Llegeix les ordres copiades de la documentació: només el text explicatiu ha de canviar.',
          'Prova una pantalla estreta i text ampliat; els controls han de continuar sent llegibles.',
          'Distingeix el text propi traduït del contingut original d’un skill de tercers.',
        ],
      },
      {
        id: 'revisio-humana',
        title: '4. Demana revisió i documenta els límits',
        paragraphs: [
          'Una comprovació automàtica detecta variables perdudes, però no tots els errors de sentit o naturalitat. Demana a una persona competent en català que revisi terminologia, coherència i adequació al públic. Marca les cadenes pendents de revisió en lloc d’afirmar que tot està validat.',
          'Per proposar una correcció a SkillsCat, inclou l’URL, el text actual, la proposta i una breu explicació. No cal justificar l’ús del català: l’objectiu és que els recursos siguin útils. Si un terme admet variants, explica el context perquè la decisió no es redueixi a una substitució mecànica.',
        ],
      },
    ],
  },
  {
    slug: 'crear-i-compartir-un-skill-en-catala',
    title: 'Crea i comparteix un skill amb instruccions en català',
    description: 'Prepara un SKILL.md clar, prova el paquet localment i tria entre proposar un repositori públic o publicar un paquet propi.',
    category: 'Contribucions',
    sections: [
      {
        id: 'tasca-petita',
        title: '1. Tria una tasca petita i descriu-ne els límits',
        paragraphs: [
          'Un primer skill pot ajudar a revisar textos en català sense reescriure codi. Explica quan s’ha d’utilitzar, quines entrades necessita i com ha de presentar el resultat. Demana explícitament que no publiqui ni modifiqui fitxers sense autorització.',
          'Crea una carpeta amb SKILL.md. El següent exemple és un punt de partida, no una certificació de compatibilitat amb tots els agents. Mantén les claus tècniques name i description; redacta les instruccions i la descripció en català.',
        ],
        code: '---\nname: revisio-catala\ndescription: Revisa textos d’interfície en català i proposa correccions justificades.\n---\n\n# Revisió de textos en català\n\n## Quan s’ha d’utilitzar\nQuan l’usuari demani revisar textos d’una interfície.\n\n## Passos\n1. Demana el públic, el to i el glossari del projecte.\n2. Conserva variables, rutes, etiquetes i ordres.\n3. Proposa una taula amb original, proposta i motiu.\n4. Marca els dubtes perquè els revisi una persona.\n\n## Límits\nNo canviïs fitxers ni publiquis res sense autorització.\nNo enviïs contingut a serveis externs.',
      },
      {
        id: 'paquet-complet',
        title: '2. Revisa els fitxers i prova el paquet localment',
        paragraphs: [
          'Si afegeixes plantilles o exemples, utilitza rutes relatives i comprova que tots els fitxers referenciats s’inclouen al paquet. No hi posis claus API, credencials ni documents de clients. Revisa la llicència dels materials que reutilitzes i atribueix-ne l’autoria quan correspongui.',
          'Des d’un projecte de prova, instal·la la carpeta local. Substitueix la ruta de l’exemple per la teva. Si la CLI et proposa publicar, rebutja-ho durant la prova: instal·lar localment i compartir a Internet són decisions diferents.',
        ],
        code: 'npx skillscat add ./revisio-catala',
        items: [
          'Prova un text correcte: l’skill no hauria d’inventar-hi errors.',
          'Prova variables i ordres: han de quedar intactes.',
          'Prova una petició fora d’abast: l’agent ha d’explicar el límit.',
          'Revisa els canvis amb una persona i anota l’agent i la versió amb què has fet la prova.',
        ],
      },
      {
        id: 'compartir',
        title: '3. Tria com vols compartir-lo',
        paragraphs: [
          'Si el paquet ja és en un repositori públic de GitHub, pots proposar el repositori a SkillsCat. Cal iniciar sessió. Substitueix https://github.com/owner/repo per l’URL real del repositori i comprova abans que tens dret a compartir tots els fitxers. La tramesa inicia el procés d’indexació; no promet una aparició immediata ni una aprovació editorial.',
          'Si vols publicar un paquet local propi, consulta publish --help i revisa la vista prèvia abans de confirmar. La CLI mostra l’slug i la visibilitat; no pressuposis que serà públic. L’slug no es pot canviar després de publicar. No utilitzis --yes si vols conservar la confirmació interactiva.',
        ],
        code: 'npx skillscat login\nnpx skillscat whoami\n\n# Opció A: proposar un repositori públic\nnpx skillscat submit https://github.com/owner/repo\n\n# Opció B: publicar un paquet propi, després de revisar-lo\nnpx skillscat publish --help\nnpx skillscat publish ./revisio-catala',
      },
      {
        id: 'despres-de-compartir',
        title: '4. Fes fàcil la revisió i la reutilització',
        paragraphs: [
          'Al README, indica que les instruccions són en català, explica els requisits i afegeix exemples sense dades reals. Si ofereixes altres llengües, identifica cada versió i com s’ha de triar; no prometis que l’agent detectarà automàticament qualsevol variant del paquet.',
          'Quan tinguis una fitxa publicada, comparteix el seu slug exacte i l’ordre d’instal·lació corresponent. Convida a comunicar problemes amb exemples reproduïbles. Compartir un skill en català és una contribució pràctica; no implica cap afiliació, reconeixement oficial ni garantia de seguretat.',
        ],
        code: 'npx skillscat add owner/my-skill',
      },
    ],
  },
];

export function getCatalanArticle(slug: string): CatalanArticle | undefined {
  return catalanArticles.find((article) => article.slug === slug);
}
