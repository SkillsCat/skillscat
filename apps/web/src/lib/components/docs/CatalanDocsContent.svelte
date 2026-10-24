<script lang="ts">
  let { kind }: { kind: 'index' | 'cli' | 'openclaw' } = $props();
</script>

{#if kind === 'index'}
  <p>SkillsCat és un registre i una CLI per a skills d’agents d’IA. Troba primer l’skill adequat i després instal·la el paquet complet en un projecte, a OpenClaw o en un entorn d’equip, sense copiar fitxers solts a mà.</p>

  <h2>Què és SkillsCat</h2>
  <ul>
    <li>Un catàleg de skills amb cerca per tasques, perquè no hagis de triar només pel nom del repositori de GitHub.</li>
    <li>Una CLI que instal·la paquets complets: <code>SKILL.md</code>, scripts, plantilles i materials de referència.</li>
    <li>Un punt d’entrada perquè OpenClaw, ClawBot i els projectes locals utilitzin la mateixa font de skills.</li>
  </ul>

  <h2>Què pots fer</h2>
  <ul>
    <li><a href="/ca/search">Cerca una tasca concreta</a> o <a href="/ca/categories">explora les categories</a>, inspecciona els fitxers i comprova l’origen abans d’instal·lar.</li>
    <li>Instal·la plantilles, scripts, configuracions i la resta del paquet conjuntament.</li>
    <li>Gestiona instal·lacions, actualitzacions, autenticació, publicació i integració amb OpenClaw des d’una mateixa eina.</li>
  </ul>
  <p>La interfície en català no altera la llengua ni el contingut dels fitxers de tercers. Els skills recents són els incorporats recentment al catàleg; les tendències ajuden a descobrir contingut, però no garanteixen la seguretat ni la compatibilitat amb el teu entorn.</p>

  <h2>Per on començar</h2>
  <p>Per aprendre a cercar, instal·lar i actualitzar, comença per la <a href="/ca/docs/cli">guia de la CLI</a>. Si ja utilitzes OpenClaw o ClawBot, o vols substituir el registre predeterminat, continua amb la <a href="/ca/docs/openclaw">guia d’OpenClaw</a>. Copia sempre l’slug exacte de la fitxa i valida el resultat en el teu projecte.</p>
  <p>També pots consultar la <a href="/ca/blog/installar-skills-amb-seguretat">revisió pràctica abans d’instal·lar</a> o el tutorial per <a href="/ca/blog/crear-i-compartir-un-skill-en-catala">crear i compartir un skill en català</a>.</p>
{:else if kind === 'cli'}
  <!-- Shared section IDs keep language-switch fragments usable; retain the original Catalan aliases. -->
  <h2 id="quick-start"><span id="preparacio">Inici ràpid</span></h2>
  <p>Necessites un terminal amb Node.js i <code>npx</code> disponibles. <code>npx</code> pot descarregar i executar la CLI: revisa el paquet i utilitza un entorn de confiança. Aquesta guia és en català; les ordres, els identificadors i els missatges del programa no es tradueixen.</p>
  <p>Executa <code>npx skillscat --help</code> per consultar les opcions de la versió que utilitzes. Les ordres que instal·len, actualitzen, eliminen o publiquen contingut tenen efectes reals: llegeix les confirmacions i no les executis només per provar la documentació.</p>

  <pre><code>npx skillscat search "code review"
npx skillscat info owner/repo
npx skillscat add owner/my-skill
npx skillscat add owner/path/to/skill
npx skillscat update --check
npx skillscat list</code></pre>

  <h2 id="search-and-inspect"><span id="cerca">Cerca i inspecciona</span></h2>
  <pre><code>npx skillscat search "revisió de textos"
npx skillscat search "localization" --limit 10
npx skillscat info owner/repo
npx skillscat add owner/repo --list</code></pre>
  <p>Substitueix <code>owner/repo</code> pel repositori real. <code>info</code> i <code>--list</code> ajuden a veure què conté un repositori abans d’instal·lar. Llegeix també els fitxers d’origen; aquestes ordres no auditen els scripts ni demostren que siguin segurs.</p>

  <h2 id="install-skills"><span id="instal-lacio">Instal·la amb l’slug exacte</span></h2>
  <pre><code>npx skillscat add owner/my-skill
npx skillscat add owner/my-skill --agent openclaw</code></pre>
  <p><code>owner/my-skill</code> és un exemple: substitueix-lo per l’slug de la fitxa. Aquesta és la via preferida per als skills ja publicats, també quan provenen d’un repositori amb diversos skills o d’una carpeta imbricada. No dedueixis l’slug a partir del nom del repositori.</p>
  <p>Segueix les indicacions interactives per triar l’agent i l’abast de la instal·lació. <code>--agent</code> selecciona un agent concret i <code>--global</code> instal·la al directori de l’usuari en lloc del projecte. Per a la primera prova, prefereix un projecte aïllat. <code>--force</code> pot sobreescriure fitxers i <code>--yes</code> omet confirmacions; no són opcions necessàries per començar.</p>
  <p>Si desenvolupes un paquet propi, <code>npx skillscat add ./el-meu-skill</code> permet instal·lar una carpeta local. Si se’t proposa publicar-la, tracta aquesta proposta com una acció separada i confirma-la només si vols compartir el contingut.</p>

  <h2 id="manage-installs"><span id="gestio">Consulta i gestiona les instal·lacions</span></h2>
  <pre><code>npx skillscat list
npx skillscat list --all
npx skillscat update --check
npx skillscat update my-skill
npx skillscat remove my-skill</code></pre>
  <p>Fes servir el nom de la instal·lació que mostra <code>list</code> en lloc de <code>my-skill</code>. <code>--check</code> comprova si hi ha actualitzacions sense instal·lar-les. Abans d’actualitzar, desa les adaptacions locals i revisa els canvis del paquet. Eliminar un skill no reverteix els efectes de les accions que l’agent ja hagi executat.</p>

  <p>Per migrar contingut existent de <code>.agents</code> a OpenClaw o actualitzar la mateixa CLI:</p>
  <pre><code>npx skillscat convert openclaw --from agents
npx skillscat self-upgrade</code></pre>

  <h2 id="auth-and-config"><span id="autenticacio">Inicia sessió i comprova la configuració</span></h2>
  <pre><code>npx skillscat login
npx skillscat whoami
npx skillscat config list
npx skillscat config get registry
npx skillscat config set registry https://skills.cat/registry
npx skillscat config delete registry
npx skillscat logout</code></pre>
  <p><code>login</code> inicia el flux d’autenticació; segueix les indicacions del terminal i comprova el domini abans d’autoritzar. Cal una sessió vàlida per publicar, proposar repositoris o accedir a contingut privat. No enganxis tokens en incidències, captures ni exemples compartits.</p>
  <p>El registre natiu és <code>https://skills.cat/registry</code>. No el confonguis amb l’entrada compatible amb ClawHub, <code>https://skills.cat/openclaw</code>. No cal canviar el registre per triar la llengua del lloc web.</p>

  <h2 id="publish-and-submit"><span id="publicacio">Proposa un repositori o publica un paquet propi</span></h2>
  <pre><code>npx skillscat submit https://github.com/owner/repo
npx skillscat publish --help
npx skillscat publish ./el-meu-skill</code></pre>
  <p><code>submit</code> proposa un repositori públic de GitHub per a la indexació. <code>publish</code> puja un paquet local i mostra una vista prèvia abans de confirmar. Revisa el nom, l’slug, els fitxers i la visibilitat; aquesta pot dependre del compte o de l’organització, i no has de donar per fet que el paquet serà públic. L’slug no es pot canviar després de publicar.</p>
  <p>Comprova les llicències i elimina credencials i dades personals. No executis totes dues ordres si només necessites una de les dues vies. Consulta el <a href="/ca/blog/crear-i-compartir-un-skill-en-catala">tutorial de creació</a> per preparar un exemple en català.</p>

  <p>Pots publicar un paquet privat o retirar-ne un que ja hagis publicat:</p>
  <pre><code>npx skillscat publish ./my-skill --private
npx skillscat unpublish owner/my-skill</code></pre>
  <p><code>unpublish</code> només s’aplica als skills privats publicats.</p>

  <h2 id="command-reference">Referència de les ordres</h2>
  <p>Consulta <code>npx skillscat --help</code> per veure les ordres disponibles i <code>npx skillscat add --help</code> per llegir les opcions d’instal·lació de la versió que utilitzes.</p>

  <table>
    <thead><tr><th>Ordre</th><th>Quan utilitzar-la</th></tr></thead>
    <tbody>
      <tr><td><code>npx skillscat search "code review"</code></td><td>Cerca skills públics a partir d’una tasca.</td></tr>
      <tr><td><code>npx skillscat info owner/repo</code></td><td>Inspecciona els skills d’un repositori abans d’instal·lar.</td></tr>
      <tr><td><code>npx skillscat add owner/my-skill</code></td><td>Instal·la un skill amb l’slug publicat exacte.</td></tr>
      <tr><td><code>npx skillscat add owner/path/to/skill</code></td><td>Instal·la un skill publicat amb una ruta imbricada.</td></tr>
      <tr><td><code>npx skillscat update --check</code></td><td>Comprova les actualitzacions sense sobreescriure la instal·lació.</td></tr>
      <tr><td><code>npx skillscat login</code></td><td>Autentica’t per accedir a skills privats o publicar.</td></tr>
      <tr><td><code>npx skillscat publish ./path/to/skill</code></td><td>Publica un paquet local.</td></tr>
    </tbody>
  </table>

  <h3 id="problemes">Si alguna cosa falla</h3>
  <ul>
    <li><strong>No es troba l’skill:</strong> copia de nou l’slug exacte i comprova que la fitxa sigui accessible.</li>
    <li><strong>Accés denegat:</strong> comprova la sessió amb <code>whoami</code> i els permisos sobre el paquet privat.</li>
    <li><strong>L’agent no el detecta:</strong> revisa l’agent seleccionat, el directori del projecte, el nom <code>SKILL.md</code> i les instruccions de recàrrega del teu agent.</li>
    <li><strong>Resultat inesperat:</strong> revisa les dependències i les instruccions originals; instal·lar un paquet no configura automàticament les eines externes que necessita.</li>
  </ul>
{:else}
  <h2 id="auto-install"><span id="registre-compatible">Si ja utilitzes un client compatible amb ClawHub</span></h2>
  <p>SkillsCat ofereix una entrada compatible amb ClawHub. El lloc és <code>https://skills.cat</code> i el registre compatible és <code>https://skills.cat/openclaw</code>. Configura’ls seguint les opcions del teu client; no pressuposis que comparteix la configuració de la CLI nativa de SkillsCat.</p>
  <pre><code>clawhub search "seo audit" --site https://skills.cat --registry https://skills.cat/openclaw
clawhub inspect &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub install &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub update &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub publish ./my-skill --slug &lt;owner&gt;~&lt;skill&gt; --version 1.0.0 --site https://skills.cat --registry https://skills.cat/openclaw</code></pre>
  <p>Els slugs compatibles utilitzen <code>~</code>, com ara <code>owner~skill</code> o <code>owner~path~to~skill</code>, també en publicar. Els clients poden descobrir l’API a <code>https://skills.cat/.well-known/clawhub.json</code>.</p>

  <h2 id="host-cli-install"><span id="instal-lar">Instal·la des de l’espai de treball d’OpenClaw</span></h2>
  <p>Primer revisa el paquet i copia l’slug exacte de la fitxa. Obre un terminal dins de l’espai de treball on vols utilitzar-lo i substitueix el marcador de posició de l’exemple:</p>
  <pre><code>npx skillscat add owner/my-skill --agent openclaw</code></pre>
  <p>La CLI instal·la el paquet complet al format de directoris d’OpenClaw. Això no executa per tu tots els passos de configuració indicats pel seu autor ni concedeix automàticament permisos perquè l’agent executi scripts.</p>
  <pre><code>npx skillscat info &lt;owner&gt;/&lt;repo&gt;
npx skillscat add &lt;slug&gt; --agent openclaw
npx skillscat add &lt;slug&gt; --agent openclaw --global
npx skillscat convert openclaw --from agents</code></pre>
  <p><code>convert openclaw --from agents</code> permet migrar contingut existent de <code>.agents</code>. Si només coneixes el repositori, inspecciona’l abans d’instal·lar amb l’slug publicat.</p>

  <h2 id="registry-override">Configura el lloc i el registre</h2>
  <p>Per a la via nativa de SkillsCat, l’ordre amb <code>--agent openclaw</code> és suficient per seleccionar el format d’instal·lació: no cal substituir el registre natiu només per fer servir OpenClaw. Els dos punts d’entrada tenen finalitats diferents.</p>
  <p>Per reutilitzar la configuració amb <code>clawhub</code>, defineix aquestes variables d’entorn. Per a una sola ordre, pots continuar utilitzant <code>--site</code> i <code>--registry</code>.</p>
  <pre><code>export CLAWHUB_SITE=https://skills.cat
export CLAWHUB_REGISTRY=https://skills.cat/openclaw

clawhub search "calendar"
clawhub install &lt;owner&gt;~&lt;skill&gt;
clawhub update &lt;owner&gt;~&lt;skill&gt;</code></pre>

  <h2 id="paths-and-layout"><span id="directoris">Directori del projecte o de l’usuari</span></h2>
  <ul>
    <li><strong>Projecte:</strong> els paquets s’instal·len dins del directori <code>skills/</code> de l’espai de treball.</li>
    <li><strong>Global:</strong> amb <code>--global</code>, el directori habitual és <code>~/.openclaw/skills/</code>.</li>
  </ul>
  <p>Per treballar en equip, prefereix l’abast del projecte i documenta els requisits. Comprova que <code>SKILL.md</code> i els fitxers associats siguin presents. Després recarrega els skills o reinicia la sessió segons la versió d’OpenClaw que utilitzis.</p>
  <table>
    <thead><tr><th>Abast</th><th>Directori</th><th>Quan utilitzar-lo</th></tr></thead>
    <tbody>
      <tr><td>Projecte</td><td><code>&lt;workspace&gt;/skills/&lt;folder-name&gt;/</code></td><td>Opció recomanada per a la col·laboració i el control de versions.</td></tr>
      <tr><td>Global</td><td><code>~/.openclaw/skills/&lt;folder-name&gt;/</code></td><td>Reutilització personal entre projectes.</td></tr>
    </tbody>
  </table>

  <h2 id="private-skills"><span id="permisos">Paquets privats, permisos i secrets</span></h2>
  <p>Els paquets privats requereixen una sessió o un token amb els permisos corresponents. Inicia sessió amb la CLI que utilitzes i no assumeixis que una credencial d’un altre servei et donarà accés. No escriguis tokens en un SKILL.md compartit ni els publiquis en una incidència.</p>
  <p>Abans de permetre que l’agent faci servir el paquet, comprova els scripts, les peticions de xarxa i els fitxers que pot llegir. Utilitza una prova sense secrets reals i concedeix només els permisos necessaris.</p>
  <pre><code>clawhub login --site https://skills.cat
clawhub login --token &lt;skillscat-api-token&gt; --site https://skills.cat --registry https://skills.cat/openclaw
npx skillscat login
npx skillscat add &lt;slug&gt; --agent openclaw</code></pre>
  <p>La sessió de <code>clawhub</code> amb SkillsCat configura el registre compatible. Pots gestionar tokens amb els permisos <code>read</code>, <code>write</code> i <code>publish</code> a la <a href="/user/tokens">pàgina de tokens d’API</a>. La CLI nativa manté la seva pròpia autenticació i no modifica la configuració de <code>clawhub</code>. Per a fluxos privats més complexos, utilitza la CLI nativa.</p>

  <h2 id="troubleshooting"><span id="diagnosi">Comprovacions si l’skill no apareix</span></h2>
  <ol>
    <li>Confirma el directori actual i si has fet una instal·lació de projecte o global.</li>
    <li>Revisa que el paquet contingui <code>SKILL.md</code> i que les rutes relatives siguin vàlides.</li>
    <li>Comprova que la sessió d’OpenClaw utilitzi aquest espai de treball i hagi recarregat els skills.</li>
    <li>Si la descàrrega falla, comprova l’slug, la visibilitat i els permisos del compte abans de repetir-la.</li>
    <li>Si falten eines o credencials, segueix les instruccions originals sense exposar secrets a l’agent innecessàriament.</li>
  </ol>
  <p>Continua amb la <a href="/ca/docs/cli">guia de la CLI</a> o la <a href="/ca/blog/installar-skills-amb-seguretat">llista de revisió abans d’instal·lar</a>.</p>
{/if}
<h3>Ajuda’ns a millorar aquesta guia</h3>
<p>La revisió lingüística per persones catalanoparlants està pendent. <a href="https://github.com/skillscat/skillscat/issues/new?title=%5Bca%5D%20Correcci%C3%B3%20de%20documentaci%C3%B3">Comunica un error o proposa una correcció</a> amb l’URL i el fragment afectat, sense dades privades. Consulta també <a href="/ca/catala">què inclou la versió en català i què queda pendent</a>.</p>
