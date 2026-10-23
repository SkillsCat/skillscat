<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import CatalanEditorialShell from '$lib/components/editorial/CatalanEditorialShell.svelte';
  let { kind }: { kind: 'index' | 'cli' | 'openclaw' } = $props();
  const title = $derived(kind === 'index' ? 'Documentació de SkillsCat' : kind === 'cli' ? 'Guia de la CLI de SkillsCat' : 'Utilitza SkillsCat amb OpenClaw');
  const description = $derived(kind === 'index'
    ? 'Troba skills per a agents d’IA, comprova’n l’origen i aprèn a instal·lar paquets complets amb la CLI de SkillsCat.'
    : kind === 'cli'
      ? 'Guia en català per cercar, inspeccionar, instal·lar i actualitzar skills, iniciar sessió i compartir paquets propis.'
      : 'Instal·la skills al teu espai de treball d’OpenClaw i entén els directoris, el registre compatible i els permisos necessaris.');
</script>

<SEO {title} {description} url={kind === 'index' ? '/docs' : `/docs/${kind}`} />
<CatalanEditorialShell eyebrow="Documentació · Català" {title} {description}>
  <DocsProseCard title={kind === 'index' ? 'Per on començo?' : kind === 'cli' ? 'Referència pràctica de la CLI' : 'Guia d’OpenClaw'}>
    {#if kind === 'index'}
      <h2>Què és un skill?</h2>
      <p>Un skill és una habilitat reutilitzable per a un agent d’IA: un conjunt d’instruccions, normalment en un fitxer <code>SKILL.md</code>, que pot incloure scripts, plantilles i materials de referència. SkillsCat t’ajuda a descobrir aquests paquets i a instal·lar-ne el contingut complet, sense copiar fitxers solts a mà.</p>
      <p>El catàleg recull contingut de diferents autors. La seva presència a SkillsCat, les estrelles o una posició destacada no són garanties de seguretat, qualitat o compatibilitat amb el teu entorn.</p>

      <h2>De la cerca a la primera prova</h2>
      <ol>
        <li><a href="/ca/search">Cerca una tasca concreta</a> o <a href="/ca/categories">explora les categories</a>. Pots provar paraules en català i en la llengua del projecte; els resultats depenen del contingut indexat.</li>
        <li>Obre la fitxa i comprova el repositori d’origen, la llicència, el fitxer <code>SKILL.md</code> i els scripts associats.</li>
        <li>Copia l’ordre d’instal·lació amb el <strong>slug exacte</strong> de la fitxa. L’slug identifica un skill publicat i no sempre coincideix amb el nom del repositori.</li>
        <li>Instal·la’l primer en un projecte de prova, limita els permisos de l’agent i valida el resultat abans d’utilitzar dades reals.</li>
      </ol>
      <p>La interfície en català no altera la llengua ni el contingut dels fitxers de tercers. Una descripció del catàleg no substitueix les instruccions originals.</p>

      <h2>Tria la guia que necessites</h2>
      <ul>
        <li><a href="/ca/docs/cli">Guia de la CLI</a>: cerca, instal·lació, actualitzacions, autenticació i publicació.</li>
        <li><a href="/ca/docs/openclaw">Guia d’OpenClaw</a>: instal·lació al directori correcte i registre compatible amb ClawHub.</li>
        <li><a href="/ca/blog/installar-skills-amb-seguretat">Revisió pràctica abans d’instal·lar</a>: origen, scripts, permisos i proves acotades.</li>
        <li><a href="/ca/blog/crear-i-compartir-un-skill-en-catala">Crea i comparteix un skill en català</a>: un exemple de paquet i els passos per proposar-lo.</li>
      </ul>
      <h2>Què volen dir les llistes del catàleg?</h2>
      <p>Els skills recents són els incorporats recentment al catàleg, no necessàriament els creats fa poc. Les tendències i les classificacions serveixen per descobrir contingut; comprova sempre que el paquet resolgui la teva tasca i sigui adequat per al teu agent.</p>
    {:else if kind === 'cli'}
      <h2 id="preparacio">Abans de començar</h2>
      <p>Necessites un terminal amb Node.js i <code>npx</code> disponibles. <code>npx</code> pot descarregar i executar la CLI: revisa el paquet i utilitza un entorn de confiança. Aquesta guia és en català; les ordres, els identificadors i els missatges del programa no es tradueixen.</p>
      <p>Executa <code>npx skillscat --help</code> per consultar les opcions de la versió que utilitzes. Les ordres que instal·len, actualitzen, eliminen o publiquen contingut tenen efectes reals: llegeix les confirmacions i no les executis només per provar la documentació.</p>

      <h2 id="cerca">Cerca i inspecciona</h2>
      <pre><code>npx skillscat search "revisió de textos"
npx skillscat search "localization" --limit 10
npx skillscat info owner/repo
npx skillscat add owner/repo --list</code></pre>
      <p>Substitueix <code>owner/repo</code> pel repositori real. <code>info</code> i <code>--list</code> ajuden a veure què conté un repositori abans d’instal·lar. Llegeix també els fitxers d’origen; aquestes ordres no auditen els scripts ni demostren que siguin segurs.</p>

      <h2 id="instal-lacio">Instal·la amb l’slug exacte</h2>
      <pre><code>npx skillscat add owner/my-skill
npx skillscat add owner/my-skill --agent openclaw</code></pre>
      <p><code>owner/my-skill</code> és un exemple: substitueix-lo per l’slug de la fitxa. Aquesta és la via preferida per als skills ja publicats, també quan provenen d’un repositori amb diversos skills o d’una carpeta imbricada. No dedueixis l’slug a partir del nom del repositori.</p>
      <p>Segueix les indicacions interactives per triar l’agent i l’abast de la instal·lació. <code>--agent</code> selecciona un agent concret i <code>--global</code> instal·la al directori de l’usuari en lloc del projecte. Per a la primera prova, prefereix un projecte aïllat. <code>--force</code> pot sobreescriure fitxers i <code>--yes</code> omet confirmacions; no són opcions necessàries per començar.</p>
      <p>Si desenvolupes un paquet propi, <code>npx skillscat add ./el-meu-skill</code> permet instal·lar una carpeta local. Si se’t proposa publicar-la, tracta aquesta proposta com una acció separada i confirma-la només si vols compartir el contingut.</p>

      <h2 id="gestio">Consulta i gestiona les instal·lacions</h2>
      <pre><code>npx skillscat list
npx skillscat list --all
npx skillscat update --check
npx skillscat update my-skill
npx skillscat remove my-skill</code></pre>
      <p>Fes servir el nom de la instal·lació que mostra <code>list</code> en lloc de <code>my-skill</code>. <code>--check</code> comprova si hi ha actualitzacions sense instal·lar-les. Abans d’actualitzar, desa les adaptacions locals i revisa els canvis del paquet. Eliminar un skill no reverteix els efectes de les accions que l’agent ja hagi executat.</p>

      <h2 id="autenticacio">Inicia sessió i comprova la configuració</h2>
      <pre><code>npx skillscat login
npx skillscat whoami
npx skillscat config get registry
npx skillscat logout</code></pre>
      <p><code>login</code> inicia el flux d’autenticació; segueix les indicacions del terminal i comprova el domini abans d’autoritzar. Cal una sessió vàlida per publicar, proposar repositoris o accedir a contingut privat. No enganxis tokens en incidències, captures ni exemples compartits.</p>
      <p>El registre natiu és <code>https://skills.cat/registry</code>. No el confonguis amb l’entrada compatible amb ClawHub, <code>https://skills.cat/openclaw</code>. No cal canviar el registre per triar la llengua del lloc web.</p>

      <h2 id="publicacio">Proposa un repositori o publica un paquet propi</h2>
      <pre><code>npx skillscat submit https://github.com/owner/repo
npx skillscat publish --help
npx skillscat publish ./el-meu-skill</code></pre>
      <p><code>submit</code> proposa un repositori públic de GitHub per a la indexació. <code>publish</code> puja un paquet local i mostra una vista prèvia abans de confirmar. Revisa el nom, l’slug, els fitxers i la visibilitat; aquesta pot dependre del compte o de l’organització, i no has de donar per fet que el paquet serà públic. L’slug no es pot canviar després de publicar.</p>
      <p>Comprova les llicències i elimina credencials i dades personals. No executis totes dues ordres si només necessites una de les dues vies. Consulta el <a href="/ca/blog/crear-i-compartir-un-skill-en-catala">tutorial de creació</a> per preparar un exemple en català.</p>

      <h2 id="problemes">Si alguna cosa falla</h2>
      <ul>
        <li><strong>No es troba l’skill:</strong> copia de nou l’slug exacte i comprova que la fitxa sigui accessible.</li>
        <li><strong>Accés denegat:</strong> comprova la sessió amb <code>whoami</code> i els permisos sobre el paquet privat.</li>
        <li><strong>L’agent no el detecta:</strong> revisa l’agent seleccionat, el directori del projecte, el nom <code>SKILL.md</code> i les instruccions de recàrrega del teu agent.</li>
        <li><strong>Resultat inesperat:</strong> revisa les dependències i les instruccions originals; instal·lar un paquet no configura automàticament les eines externes que necessita.</li>
      </ul>
    {:else}
      <h2 id="instal-lar">Instal·la des de l’espai de treball d’OpenClaw</h2>
      <p>Primer revisa el paquet i copia l’slug exacte de la fitxa. Obre un terminal dins de l’espai de treball on vols utilitzar-lo i substitueix el marcador de posició de l’exemple:</p>
      <pre><code>npx skillscat add owner/my-skill --agent openclaw</code></pre>
      <p>La CLI instal·la el paquet complet al format de directoris d’OpenClaw. Això no executa per tu tots els passos de configuració indicats pel seu autor ni concedeix automàticament permisos perquè l’agent executi scripts.</p>

      <h2 id="directoris">Directori del projecte o de l’usuari</h2>
      <ul>
        <li><strong>Projecte:</strong> els paquets s’instal·len dins del directori <code>skills/</code> de l’espai de treball.</li>
        <li><strong>Global:</strong> amb <code>--global</code>, el directori habitual és <code>~/.openclaw/skills/</code>.</li>
      </ul>
      <p>Per treballar en equip, prefereix l’abast del projecte i documenta els requisits. Comprova que <code>SKILL.md</code> i els fitxers associats siguin presents. Després recarrega els skills o reinicia la sessió segons la versió d’OpenClaw que utilitzis.</p>

      <h2 id="registre-compatible">Si ja utilitzes un client compatible amb ClawHub</h2>
      <p>SkillsCat ofereix una entrada compatible amb ClawHub. El lloc és <code>https://skills.cat</code> i el registre compatible és <code>https://skills.cat/openclaw</code>. Configura’ls seguint les opcions del teu client; no pressuposis que comparteix la configuració de la CLI nativa de SkillsCat.</p>
      <p>Per a la via nativa de SkillsCat, l’ordre amb <code>--agent openclaw</code> és suficient per seleccionar el format d’instal·lació: no cal substituir el registre natiu només per fer servir OpenClaw. Els dos punts d’entrada tenen finalitats diferents.</p>

      <h2 id="permisos">Paquets privats, permisos i secrets</h2>
      <p>Els paquets privats requereixen una sessió o un token amb els permisos corresponents. Inicia sessió amb la CLI que utilitzes i no assumeixis que una credencial d’un altre servei et donarà accés. No escriguis tokens en un SKILL.md compartit ni els publiquis en una incidència.</p>
      <p>Abans de permetre que l’agent faci servir el paquet, comprova els scripts, les peticions de xarxa i els fitxers que pot llegir. Utilitza una prova sense secrets reals i concedeix només els permisos necessaris.</p>

      <h2 id="diagnosi">Comprovacions si l’skill no apareix</h2>
      <ol>
        <li>Confirma el directori actual i si has fet una instal·lació de projecte o global.</li>
        <li>Revisa que el paquet contingui <code>SKILL.md</code> i que les rutes relatives siguin vàlides.</li>
        <li>Comprova que la sessió d’OpenClaw utilitzi aquest espai de treball i hagi recarregat els skills.</li>
        <li>Si la descàrrega falla, comprova l’slug, la visibilitat i els permisos del compte abans de repetir-la.</li>
        <li>Si falten eines o credencials, segueix les instruccions originals sense exposar secrets a l’agent innecessàriament.</li>
      </ol>
      <p>Continua amb la <a href="/ca/docs/cli">guia de la CLI</a> o la <a href="/ca/blog/installar-skills-amb-seguretat">llista de revisió abans d’instal·lar</a>.</p>
    {/if}
    <h2>Ajuda’ns a millorar aquesta guia</h2>
    <p>La revisió lingüística per persones catalanoparlants està pendent. <a href="https://github.com/skillscat/skillscat/issues/new?title=%5Bca%5D%20Correcci%C3%B3%20de%20documentaci%C3%B3">Comunica un error o proposa una correcció</a> amb l’URL i el fragment afectat, sense dades privades. Consulta també <a href="/ca/catala">què inclou la versió en català i què queda pendent</a>.</p>
  </DocsProseCard>
</CatalanEditorialShell>
