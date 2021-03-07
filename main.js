const fs = require("fs");
const LZ4 = require("lz4");
const FuzzyMatching = require("fuzzy-matching");

const toWords = text => text.split(/\s+/).map(x => x.replace(/\W/g, "").toLowerCase());
function setIntersectTwo(a, b) {
    let small = a, large = b;
    if (small.length > large.length)
        [small, large] = [large, small];
    let retset = new Set();
    for (let x of small) {
        if (large.has(x)) retset.add(x);
    }
    return retset;
}
function setIntersect(...sets) {
    sets = sets.sort((a, b) => a.length > b.length ? 1 : -1);
    for (let i = 1; i < sets.length; ++i) {
        sets[0] = setIntersectTwo(sets[0], sets[i]);
    }
    return sets[0];
}

const searchCandidates = (index, searchTerm) =>
    setIntersect(...toWords(searchTerm).map(x => index[x.slice(0, 4)]));

const fuzzySearchIndex = (haystack, needle) =>
    toWords(haystack)
        .map(word => new FuzzyMatching([word]).get(needle))
        .reduce((acc, x, i) => 
            acc.distance > x.distance ? acc : {...x, i},
            {distance: -1.0});


let filedata = fs.readFileSync("./chatlog.log").toString();
let lines = filedata.split(/\n/);

let messages = [];
let date = null;
for (let i = 0; i < lines.length; ++i) {
    if (lines[i].trim() == "") {
        continue;
    } else if (lines[i].startsWith("[")) {
        let [, timestr, user, body] = lines[i].match(/^\[(\d{2}:\d{2}:\d{2})\] (?:<([\w\d]+)>)?(.*)/);
        let timestrs = timestr.split(":");
        let time = parseInt(timestrs[0])*3600 + parseInt(timestrs[1])*60 + parseInt(timestrs[2]);
        messages.push({date: date + time, user: user || "server", body: body});
    } else {
        date = Date.parse(lines[i]);
    }
}

let index = {};
const kBlockSize = 100;
for (let i = 0, block = 0; i < messages.length; i += kBlockSize, ++block) {
    let messageBlock = messages.slice(i, i + kBlockSize)
    for (let [j, {body}] of messageBlock.entries()) {
        toWords(body)
            .map(x => x.slice(0, 4))
            .filter(x => x.length > 0)
            .forEach(x => {
                index[x] ||= new Set();
                index[x].add(block + ":" + j);
            });
    }
    let json = JSON.stringify(messageBlock);
    fs.writeFileSync(`./blocks/${block}.json`, LZ4.encode(json));
}

function findLines(searchTerm) {
    let matchedlines = [];
    let numcandidates = 0;
    let numdecomp = 0;
    let decompblocks = {};

    for (let ipos of searchCandidates(index, searchTerm)) {
        ++numcandidates;
        let [block, mesg] = ipos.split(":").map(x => parseInt(x));
        let mesgBlock
        if (!decompblocks[block]) {
            mesgBlock = JSON.parse(LZ4.decode(fs.readFileSync(`./blocks/${block}.json`)).toString());
            decompblocks[block] = mesgBlock;
            ++numdecomp;
        } else {
            mesgBlock = decompblocks[block];
        }
        let line = mesgBlock[mesg];

        let matches = [];
        let words = toWords(searchTerm);
        let meanpos = 0.0;
        for (let word of words) {
            let match = fuzzySearchIndex(line.body, word);
            matches.push(match);
            meanpos += match.i;
        }
        meanpos /= words.length;
        let dist = matches.reduce((acc, x) => acc + x.distance, 0.0) / words.length;
        let stdev = Math.sqrt(matches.reduce((acc, x) => acc + Math.pow(x.i - meanpos, 2), 0.0) / matches.length);

        if (stdev / 3.0 + dist < 2.0) {
            line.body = line.body.split(" ").slice(Math.max(0, meanpos - words.length - 4), meanpos + words.length + 4).join(" ");
            matchedlines.push(line);
        }
    }
    console.log(`searched ${numcandidates} candidates`);
    console.log(`decompressed ${numcandidates} blocks`);
    return matchedlines;
}

let start = Date.now();
console.log("\n" + findLines("trying upload").map(x => `>>>${x.user} - ${x.body}`).join("\n"))
let end = Date.now();
console.log();
console.log(`search completed in ${end - start}ms`);