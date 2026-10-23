<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import CatalanEditorialShell from '$lib/components/editorial/CatalanEditorialShell.svelte';
  const title = 'SkillsCat 🧡 Català';
  const description = 'Un espai per descobrir, aprendre i compartir skills en català, amb recursos concrets i una invitació oberta a millorar-los.';
</script>

<SEO {title} {description} url="/ca/catala" />
<CatalanEditorialShell eyebrow="La llengua també forma part de l’experiència" {title} {description}>
  <DocsProseCard title="Un lloc per al català">
    <p>Volem que les persones que treballen en català puguin trobar eines i entendre com fer-les servir sense haver de començar sempre en una altra llengua. Aquest espai és per a qualsevol persona que utilitzi o aprengui català, sigui on sigui.</p>
    <p>No volem limitar-nos a un missatge de benvinguda: aquí tens una interfície traduïda, documentació pràctica i maneres concretes de contribuir.</p>

    <h2>Recursos disponibles en aquesta versió</h2>
    <ul>
      <li><a href="/ca">Explora SkillsCat en català</a>: navegació, cerca, categories i controls de les fitxes.</li>
      <li><a href="/ca/docs">Comença amb la documentació</a> i consulta les guies de la <a href="/ca/docs/cli">CLI</a> i d’<a href="/ca/docs/openclaw">OpenClaw</a>.</li>
      <li><a href="/ca/blog">Llegeix els tres tutorials en català</a>: revisió abans d’instal·lar, localització i creació d’un skill propi.</li>
    </ul>

    <h2>Què està fet i què queda pendent</h2>
    <p><strong>Disponible:</strong> la interfície principal i aquests recursos propis en català, amb accés des del selector de llengua i el peu de pàgina.</p>
    <p><strong>Pendent de revisió:</strong> la naturalitat, la terminologia i la coherència de les traduccions per part de persones catalanoparlants. Si una pantalla encara mostra text en anglès, es pot comunicar com una mancança; no afirmem que tota la plataforma estigui traduïda.</p>
    <p><strong>Fora d’aquesta versió:</strong> la traducció de tots els paquets de tercers i dels missatges del programa de terminal. La guia de la CLI és en català, però les ordres i la sortida de la CLI es mantenen en la llengua del programa. Les ampliacions dependran de les contribucions i de la revisió del projecte; no anunciem un calendari que no estigui acordat.</p>

    <h2>El contingut original continua sent de l’autor</h2>
    <p>Canviar la llengua de la interfície no canvia el fitxer SKILL.md, els scripts ni els altres fitxers d’un skill. Llegeix el contingut original i comprova l’origen abans d’instal·lar. Una fitxa traduïda no implica que l’skill entengui català ni que hagi estat auditat.</p>
    <p>Si crees una versió en català d’un projecte aliè, respecta’n la llicència i l’autoria, diferencia la traducció de l’original i explica com l’has provada.</p>

    <h2>Participa-hi de la manera que et sigui útil</h2>
    <ul>
      <li><a href="https://github.com/skillscat/skillscat/issues/new?title=%5Bca%5D%20Proposta%20de%20correcci%C3%B3">Comunica una correcció lingüística</a>: indica l’URL, el text actual i la teva proposta. No hi afegeixis dades privades.</li>
      <li><a href="https://github.com/skillscat/skillscat/tree/main/apps/web/src/lib/i18n">Revisa els catàlegs de traducció al repositori</a> i proposa un canvi amb context.</li>
      <li><a href="/ca/blog/crear-i-compartir-un-skill-en-catala">Crea o proposa un skill en català</a>, amb instruccions clares i exemples que altres persones puguin provar.</li>
      <li><a href="https://github.com/skillscat/skillscat/issues">Consulta les incidències del projecte</a> abans d’obrir-ne una de nova.</li>
    </ul>
    <p>Les contribucions a GitHub requereixen un compte. Obrir una incidència o proposar un canvi no en garanteix l’acceptació ni un termini de resposta.</p>

    <h2>Una iniciativa pròpia, sense avals implícits</h2>
    <p>Aquesta pàgina expressa la voluntat de SkillsCat de fer lloc al català. No representa cap entitat lingüística ni implica col·laboracions, reconeixements oficials o una certificació vinculada al domini .cat.</p>
  </DocsProseCard>
</CatalanEditorialShell>
